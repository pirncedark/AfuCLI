import { describe, expect, it } from "bun:test";
import {
	getLatestWindowsRelease,
	resolveReleaseBinaryAsset,
	selectFallbackBinaryAsset,
} from "../../src/cli/update-cli";

const name = "afu-windows-x64.exe";
const digest = `sha256:${"ab".repeat(32)}`;
function release(version: string) {
	const tag = `afu-v${version}`;
	return {
		tag_name: tag,
		draft: false,
		prerelease: false,
		assets: [
			{
				name,
				state: "uploaded",
				size: 123,
				digest,
				browser_download_url: `https://github.com/pirncedark/AfuCLI/releases/download/${tag}/${name}`,
			},
		],
	};
}

describe("AFU Windows releases", () => {
	it("downloads the fork asset and returns a comparable version without the AFU tag prefix", () => {
		expect(resolveReleaseBinaryAsset(release("18.4.13"), "afu-v18.4.13", name)).toEqual({
			version: "18.4.13",
			size: 123,
			digest,
			url: `https://github.com/pirncedark/AfuCLI/releases/download/afu-v18.4.13/${name}`,
		});
	});
	it("ignores native-only and incomplete releases when choosing an AFU update", () => {
		expect(
			selectFallbackBinaryAsset(
				[
					{ ...release("18.4.99"), tag_name: "afu-natives-18.4.99" },
					{ ...release("18.4.14"), assets: [] },
					release("18.4.13"),
				],
				name,
				"18.4.12",
			)?.version,
		).toBe("18.4.13");
	});
	it("checks GitHub instead of npm and forces standalone binary updates", async () => {
		const urls: string[] = [];
		const latest = await getLatestWindowsRelease({ githubToken: "" }, async input => {
			urls.push(String(input));
			return Response.json([release("18.4.13")]);
		});
		expect(urls).toEqual(["https://api.github.com/repos/pirncedark/AfuCLI/releases?per_page=30"]);
		expect(latest.version).toBe("18.4.13");
		expect(latest.dist).toBe("binary");
	});
});
