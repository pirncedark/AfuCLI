#!/usr/bin/env bun

/**
 * Persist the cargo `target/` directory to the in-cluster RustFS S3 bucket
 * between omp-kata CI runs.
 *
 * sccache only caches rustc invocations; build-script outputs (57 tree-sitter
 * grammar C compiles, audiopus_sys' bundled opus via CMake, ring's asm) and
 * cargo's fingerprint/link work bypass it entirely. Restoring `target/` reuses
 * all of that, so a warm native job only recompiles workspace crates.
 *
 * Storage model: one object per cache key (`target-cache/<key>-<toolchain>.tar.zst`),
 * overwritten on every save — storage stays bounded at one snapshot per
 * platform/libc/arch/variant/toolchain. Staleness is safe: cargo fingerprints
 * invalidate anything that no longer matches, exactly like Swatinem/rust-cache
 * on the GitHub-hosted runners.
 *
 * Credentials/config come from the pod-wide sccache env (`SCCACHE_BUCKET`,
 * `SCCACHE_ENDPOINT`, `SCCACHE_S3_USE_SSL`, `AWS_*`); Bun's S3Client reads the
 * AWS credentials from the environment. Off-infra (no `SCCACHE_BUCKET`) and
 * every failure path degrade to a logged no-op — this script must never fail
 * a CI job.
 *
 * Usage: `bun scripts/ci-target-cache.ts <restore|save> <cache-key>`
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { $, S3Client } from "bun";

const repoRoot = path.join(import.meta.dir, "..");

/** Compressed snapshots above this size are not uploaded; the next full miss rebuilds a compact one. */
const MAX_SNAPSHOT_BYTES = 4 * 1024 ** 3;
const EXISTS_TIMEOUT_MS = 30_000;
const DOWNLOAD_TIMEOUT_MS = 180_000;
const UPLOAD_TIMEOUT_MS = 300_000;

/**
 * Resolve the S3 endpoint URL from the sccache pod env. `SCCACHE_ENDPOINT` is
 * host:port without a scheme; `SCCACHE_S3_USE_SSL=true` selects https,
 * anything else http (in-cluster RustFS serves plain HTTP). A value that
 * already carries a scheme is passed through untouched.
 */
export function resolveEndpoint(env: Record<string, string | undefined>): string | null {
	const endpoint = env.SCCACHE_ENDPOINT?.trim();
	if (!endpoint) return null;
	if (/^[a-z][a-z0-9+.-]*:\/\//i.test(endpoint)) return endpoint;
	const scheme = env.SCCACHE_S3_USE_SSL === "true" ? "https" : "http";
	return `${scheme}://${endpoint}`;
}

/**
 * Object key for one snapshot. The toolchain fingerprint (`rustc -V`) is
 * hashed in so a nightly bump becomes a clean miss instead of a useless
 * multi-GB restore that cargo immediately invalidates.
 */
export function objectKeyFor(cacheKey: string, rustcVersion: string): string {
	if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(cacheKey)) {
		throw new Error(`Invalid cache key ${JSON.stringify(cacheKey)}; expected [A-Za-z0-9._-]+`);
	}
	const toolchain = new Bun.CryptoHasher("sha256").update(rustcVersion).digest("hex").slice(0, 12);
	return `target-cache/${cacheKey}-${toolchain}.tar.zst`;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
	const { promise: timeout, reject } = Promise.withResolvers<never>();
	const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
	return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** `target_directory` from cargo metadata (honors CARGO_TARGET_DIR/config), falling back to `<repo>/target`. */
async function resolveTargetDir(): Promise<string> {
	const meta = await $`cargo metadata --no-deps --format-version 1`.cwd(repoRoot).quiet().nothrow();
	if (meta.exitCode === 0) {
		try {
			const parsed = meta.json() as { target_directory?: string };
			if (parsed.target_directory) return parsed.target_directory;
		} catch {
			// fall through to default
		}
	}
	return path.join(repoRoot, "target");
}

async function restore(s3: S3Client, objectKey: string, targetDir: string): Promise<void> {
	const object = s3.file(objectKey);
	if (!(await withTimeout(object.exists(), EXISTS_TIMEOUT_MS, "cache lookup"))) {
		console.log(`target cache miss: ${objectKey}`);
		return;
	}
	const tmpTar = path.join(Bun.env.RUNNER_TEMP ?? os.tmpdir(), `target-cache-${process.pid}.tar.zst`);
	const started = Bun.nanoseconds();
	try {
		// NB: `Bun.write(dest, new Response(s3file.stream()))` never resolves in
		// Bun 1.3.x; iterating the stream into a FileSink works.
		const download = async () => {
			const sink = Bun.file(tmpTar).writer();
			for await (const chunk of object.stream()) sink.write(chunk);
			await sink.end();
		};
		await withTimeout(download(), DOWNLOAD_TIMEOUT_MS, "cache download");
		const sizeMb = (Bun.file(tmpTar).size / 1024 ** 2).toFixed(0);
		// Explicit decompress pipe: GNU tar passes -d to a --use-compress-program
		// filter on extract but bsdtar does not, so filter flags are a trap.
		// The pipe reports only tar's exit code, which reads a truncated zstd
		// stream as a short-but-valid archive — so verify the zstd layer first.
		const verify = await $`zstd -tq ${tmpTar}`.quiet().nothrow();
		const extract =
			verify.exitCode === 0
				? await $`zstd -dcq ${tmpTar} | tar -xf - -C ${path.dirname(targetDir)}`.quiet().nothrow()
				: verify;
		if (extract.exitCode !== 0) {
			// A torn/corrupt snapshot must not leave a half-extracted target/
			// behind: cargo would trust whatever fingerprints survived.
			await fs.rm(targetDir, { recursive: true, force: true });
			console.warn(
				`target cache extract failed (exit ${extract.exitCode}); removed ${targetDir} and continuing cold`,
			);
			return;
		}
		const secs = ((Bun.nanoseconds() - started) / 1e9).toFixed(1);
		console.log(`target cache restored: ${objectKey} (${sizeMb} MiB in ${secs}s)`);
	} finally {
		await fs.rm(tmpTar, { force: true });
	}
}

async function save(s3: S3Client, objectKey: string, targetDir: string): Promise<void> {
	try {
		await fs.stat(targetDir);
	} catch {
		console.log(`target cache save skipped: ${targetDir} does not exist`);
		return;
	}
	const tmpTar = path.join(Bun.env.RUNNER_TEMP ?? os.tmpdir(), `target-cache-${process.pid}.tar.zst`);
	const started = Bun.nanoseconds();
	try {
		// CARGO_INCREMENTAL=0 in CI, so incremental/ only exists from stray
		// local state; exclude it regardless — it is the one cargo dir that is
		// pure dead weight for a cold consumer. Explicit compress pipe for the
		// same tar-flavor reason as in restore(); -T0 uses all cores.
		const create =
			await $`tar -cf - --exclude=${"*/incremental"} -C ${path.dirname(targetDir)} ${path.basename(targetDir)} | zstd -q -T0 -3 -f -o ${tmpTar}`
				.quiet()
				.nothrow();
		if (create.exitCode !== 0) {
			console.warn(`target cache save skipped: tar failed (exit ${create.exitCode})`);
			return;
		}
		const size = Bun.file(tmpTar).size;
		if (size > MAX_SNAPSHOT_BYTES) {
			// Orphaned artifacts accumulate across restore→build→save cycles;
			// refusing oversized uploads bounds the object. The stale snapshot
			// keeps serving restores until a full-miss rebuild saves a compact one.
			console.warn(
				`target cache save skipped: snapshot ${(size / 1024 ** 3).toFixed(1)} GiB exceeds ${MAX_SNAPSHOT_BYTES / 1024 ** 3} GiB cap`,
			);
			return;
		}
		await withTimeout(s3.write(objectKey, Bun.file(tmpTar)), UPLOAD_TIMEOUT_MS, "cache upload");
		const secs = ((Bun.nanoseconds() - started) / 1e9).toFixed(1);
		console.log(`target cache saved: ${objectKey} (${(size / 1024 ** 2).toFixed(0)} MiB in ${secs}s)`);
	} finally {
		await fs.rm(tmpTar, { force: true });
	}
}

async function main(): Promise<void> {
	const [mode, cacheKey] = [process.argv[2], process.argv[3]];
	if ((mode !== "restore" && mode !== "save") || !cacheKey) {
		console.error("Usage: bun scripts/ci-target-cache.ts <restore|save> <cache-key>");
		process.exit(1);
	}

	const bucket = Bun.env.SCCACHE_BUCKET;
	const endpoint = resolveEndpoint(Bun.env);
	if (!bucket || !endpoint) {
		console.log("target cache skipped: no SCCACHE_BUCKET/SCCACHE_ENDPOINT in env (not on omp-kata infra)");
		return;
	}
	if (!Bun.which("zstd")) {
		console.warn("target cache skipped: zstd not on PATH");
		return;
	}
	const rustc = await $`rustc -V`.quiet().nothrow();
	if (rustc.exitCode !== 0) {
		console.warn("target cache skipped: rustc not on PATH");
		return;
	}

	const objectKey = objectKeyFor(cacheKey, rustc.text().trim());
	const s3 = new S3Client({ bucket, endpoint, region: Bun.env.SCCACHE_REGION ?? Bun.env.AWS_REGION ?? "us-east-1" });
	const targetDir = await resolveTargetDir();
	if (mode === "restore") await restore(s3, objectKey, targetDir);
	else await save(s3, objectKey, targetDir);
}

if (import.meta.main) {
	try {
		await main();
	} catch (err) {
		// Cache trouble must never fail a build; cold compile is the fallback.
		console.warn(`target cache ${process.argv[2] ?? ""} failed non-fatally:`, err);
	}
}
