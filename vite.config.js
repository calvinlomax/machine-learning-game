import { defineConfig } from "vite";

const repoName = process.env.GITHUB_REPOSITORY?.split("/")[1];
const inferredProductionBase = repoName ? `/${repoName}/` : "/";
const base =
  process.env.VITE_BASE_PATH ||
  (process.env.NODE_ENV === "production" ? inferredProductionBase : "/");

export default defineConfig({
  base
});
