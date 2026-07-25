import { describe, expect, test } from "bun:test";
import { objectKeyFor, resolveEndpoint } from "./ci-target-cache";

describe("resolveEndpoint", () => {
	test("selects scheme from SCCACHE_S3_USE_SSL, defaulting to http for in-cluster RustFS", () => {
		expect(resolveEndpoint({ SCCACHE_ENDPOINT: "rustfs.sccache.svc.cluster.local:9000" })).toBe(
			"http://rustfs.sccache.svc.cluster.local:9000",
		);
		expect(resolveEndpoint({ SCCACHE_ENDPOINT: "rustfs:9000", SCCACHE_S3_USE_SSL: "true" })).toBe(
			"https://rustfs:9000",
		);
		expect(resolveEndpoint({ SCCACHE_ENDPOINT: "rustfs:9000", SCCACHE_S3_USE_SSL: "false" })).toBe(
			"http://rustfs:9000",
		);
	});

	test("passes through endpoints that already carry a scheme and rejects missing config", () => {
		expect(resolveEndpoint({ SCCACHE_ENDPOINT: "https://s3.example.com" })).toBe("https://s3.example.com");
		expect(resolveEndpoint({})).toBeNull();
		expect(resolveEndpoint({ SCCACHE_ENDPOINT: "  " })).toBeNull();
	});
});

describe("objectKeyFor", () => {
	test("namespaces snapshots under target-cache/ and separates toolchains", () => {
		const stable = objectKeyFor("native-linux-default-x64-baseline", "rustc 1.91.0-nightly (abc 2026-04-29)");
		expect(stable).toMatch(/^target-cache\/native-linux-default-x64-baseline-[0-9a-f]{12}\.tar\.zst$/);
		// Same inputs must be deterministic; a toolchain bump must be a clean miss.
		expect(objectKeyFor("native-linux-default-x64-baseline", "rustc 1.91.0-nightly (abc 2026-04-29)")).toBe(stable);
		expect(objectKeyFor("native-linux-default-x64-baseline", "rustc 1.92.0-nightly (def 2026-06-01)")).not.toBe(
			stable,
		);
	});

	test("rejects keys that could escape the target-cache/ prefix", () => {
		expect(() => objectKeyFor("../sccache-poison", "rustc 1.91.0")).toThrow(/Invalid cache key/);
		expect(() => objectKeyFor("a/b", "rustc 1.91.0")).toThrow(/Invalid cache key/);
		expect(() => objectKeyFor("", "rustc 1.91.0")).toThrow(/Invalid cache key/);
	});
});
