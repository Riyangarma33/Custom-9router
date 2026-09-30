import path from "node:path";
import fs from "node:fs";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(import.meta.dirname, "..");

function tryResolveFile(basePath) {
  if (fs.existsSync(basePath) && fs.statSync(basePath).isFile()) {
    return basePath;
  }
  const extensions = [".js", ".mjs", ".cjs", ".json"];
  for (const ext of extensions) {
    const candidate = basePath + ext;
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }
  const indexCandidate = path.join(basePath, "index.js");
  if (fs.existsSync(indexCandidate) && fs.statSync(indexCandidate).isFile()) {
    return indexCandidate;
  }
  return basePath;
}

export async function resolve(specifier, context, defaultResolve) {
  if (specifier === "next/server") {
    return defaultResolve("next/server.js", context);
  }
  if (specifier === "next/headers") {
    return defaultResolve("next/headers.js", context);
  }
  if (specifier === "@/models") {
    const file = path.join(ROOT, "src", "models", "index.js");
    return defaultResolve(pathToFileURL(file).href, context);
  }
  if (specifier.startsWith("@/")) {
    const rel = specifier.slice(2);
    const target = tryResolveFile(path.join(ROOT, "src", rel));
    return defaultResolve(pathToFileURL(target).href, context);
  }
  if (specifier === "open-sse" || specifier.startsWith("open-sse/")) {
    const rel = specifier === "open-sse" ? "index.js" : specifier.slice("open-sse/".length);
    const target = tryResolveFile(path.join(ROOT, "open-sse", rel));
    return defaultResolve(pathToFileURL(target).href, context);
  }
  return defaultResolve(specifier, context);
}
