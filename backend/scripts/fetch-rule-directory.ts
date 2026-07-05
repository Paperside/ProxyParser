// 生成规则库「扩展目录」索引：bun scripts/fetch-rule-directory.ts
// 遍历 blackmatrix7/ios_rule_script 仓库 rule/Clash/ 下的全部规则组文件夹，
// 为每个文件夹挑选一个代表性文件（优先 classical 合并版），写入
// assets/rulesets/directory.json，供规则库页面搜索/分页浏览与一键导入。
// 这些条目不预置离线快照内容——用户点击导入时才实时抓取（复用 importFromUrl）。
//
// 用一次 Git Trees API 调用取全仓文件列表，避免逐目录调用触发 GitHub 未认证
// 60 次/小时的速率限制。如需更高频刷新，可设置 GITHUB_TOKEN 环境变量。
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO = "blackmatrix7/ios_rule_script";
const BRANCH = "master";
const assetsDir = resolve(import.meta.dir, "../assets/rulesets");

interface TreeEntry {
  path: string;
  type: "blob" | "tree";
}

interface DirectoryEntry {
  slug: string;
  name: string;
  behavior: "classical" | "domain";
  sourceUrl: string;
}

const authHeaders = (): Record<string, string> => {
  const token = process.env.GITHUB_TOKEN;
  return token ? { Authorization: `Bearer ${token}` } : {};
};

const fetchTree = async (): Promise<TreeEntry[]> => {
  const response = await fetch(
    `https://api.github.com/repos/${REPO}/git/trees/${BRANCH}?recursive=1`,
    { headers: authHeaders() }
  );
  if (!response.ok) {
    throw new Error(`GitHub API HTTP ${response.status}`);
  }
  const data = (await response.json()) as { tree: TreeEntry[]; truncated: boolean };
  if (data.truncated) {
    throw new Error("Git tree 响应被截断，仓库过大，需要改用分批遍历。");
  }
  return data.tree;
};

// 每个目录下按优先级挑一个文件：合并版 classical 优先，其次单文件 classical，
// 没有 No_Resolve 变体时退回默认（原始）版本。
const pickFile = (name: string, files: Set<string>): { file: string; behavior: DirectoryEntry["behavior"] } | null => {
  const classicalCandidates = [
    `${name}_Classical_No_Resolve.yaml`,
    `${name}_No_Resolve.yaml`,
    `${name}_Classical.yaml`,
    `${name}.yaml`
  ];
  for (const candidate of classicalCandidates) {
    if (files.has(candidate)) {
      return { file: candidate, behavior: "classical" };
    }
  }
  if (files.has(`${name}_Domain.yaml`)) {
    return { file: `${name}_Domain.yaml`, behavior: "domain" };
  }
  return null;
};

const toSlug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const main = async () => {
  const tree = await fetchTree();
  const filesByDir = new Map<string, Set<string>>();

  for (const entry of tree) {
    if (entry.type !== "blob" || !entry.path.startsWith("rule/Clash/")) continue;
    const parts = entry.path.split("/");
    if (parts.length !== 4) continue; // rule/Clash/<Name>/<file>
    const [, , dirName, fileName] = parts;
    if (!dirName || !fileName) continue;
    if (!filesByDir.has(dirName)) filesByDir.set(dirName, new Set());
    filesByDir.get(dirName)!.add(fileName);
  }

  const directory: DirectoryEntry[] = [];
  const skipped: string[] = [];

  for (const [name, files] of filesByDir) {
    const picked = pickFile(name, files);
    if (!picked) {
      skipped.push(name);
      continue;
    }
    directory.push({
      slug: toSlug(name),
      name,
      behavior: picked.behavior,
      sourceUrl: `https://raw.githubusercontent.com/${REPO}/${BRANCH}/rule/Clash/${name}/${picked.file}`
    });
  }

  directory.sort((a, b) => a.name.localeCompare(b.name));
  writeFileSync(resolve(assetsDir, "directory.json"), JSON.stringify(directory, null, 2));

  console.log(`written ${directory.length} 条到 assets/rulesets/directory.json`);
  if (skipped.length > 0) {
    console.log(`跳过 ${skipped.length} 个无法识别的目录：${skipped.join(", ")}`);
  }
};

if (import.meta.main) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
