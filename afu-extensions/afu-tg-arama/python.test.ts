import { expect, test } from "bun:test";

test("Python JSONL ve ses parçalama sözleşmeleri ağsız geçer", async () => {
	const child = Bun.spawn(["python", "-B", "-m", "unittest", "-v", "test_arama"], {
		cwd: import.meta.dir, stdout: "pipe", stderr: "pipe", windowsHide: true,
		env: { ...process.env, PYTHONUTF8: "1", PYTHONDONTWRITEBYTECODE: "1", AFU_TG_API_ID: "", AFU_TG_API_HASH: "", AFU_TG_ARANAN: "" },
	});
	const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
	if (code !== 0) throw new Error(`${stdout}\n${stderr}`);
	expect(code).toBe(0);
});
