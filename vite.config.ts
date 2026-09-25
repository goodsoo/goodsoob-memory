/// <reference types="vitest/config" />
import { execSync } from "node:child_process";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import * as babel from "@babel/core";

// 현재 체크아웃된 git 브랜치 — dev 창 제목에 박아 worktree 세션을 구분한다.
// config 평가 시점(=dev 서버 기동 시점)에 한 번 읽으므로 worktree 별로 다른 값이 들어간다.
function currentBranch(): string {
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

// dev-inspector: 각 intrinsic JSX 요소에 data-loc="파일:줄" 주입 → 클로드가 grep 없이 소스 착지.
// @vitejs/plugin-react 6 은 Oxc 라 babel 옵션이 없어 pre transform 훅에서 @babel/core 로 주입.
function locBabelPlugin(rel: string) {
  return function ({ types: t }: { types: any }) {
    return {
      name: 'jsx-loc-inner',
      visitor: {
        JSXOpeningElement(path: any) {
          const node = path.node
          if (!node.loc || !t.isJSXIdentifier(node.name)) return
          if (!/^[a-z]/.test(node.name.name)) return
          if (node.attributes.some((a: any) => t.isJSXAttribute(a) && a.name?.name === 'data-loc')) return
          node.attributes.push(t.jsxAttribute(t.jsxIdentifier('data-loc'), t.stringLiteral(rel + ':' + node.loc.start.line)))
        },
      },
    }
  }
}
function jsxLocPlugin(): import('vite').Plugin {
  const root = process.cwd()
  return {
    name: 'jsx-loc',
    enforce: 'pre',
    async transform(code, id) {
      if (!/\.[jt]sx$/.test(id) || id.includes('node_modules') || !code.includes('<')) return null
      const rel = id.startsWith(root) ? id.slice(root.length).replace(/^\//, '') : id
      const result = await babel.transformAsync(code, {
        filename: id,
        parserOpts: { plugins: ['jsx', 'typescript'] },
        plugins: [locBabelPlugin(rel)],
        generatorOpts: { retainLines: true },
        babelrc: false, configFile: false, sourceMaps: true,
      })
      if (!result?.code) return null
      return { code: result.code, map: result.map as any }
    },
  }
}

export default defineConfig({
  server: {
    port: Number(process.env.VITE_PORT) || 7022,
    strictPort: true,
  },
  define: {
    __DEV_BRANCH__: JSON.stringify(currentBranch()),
  },
  plugins: [jsxLocPlugin(), react(), tailwindcss()],
  // 심링크된 @goodsoob/ds 가 자기 node_modules/react 로 해소돼 React 가 2벌 번들되면
  // 훅 dispatcher 가 null → "Cannot read properties of null (reading 'useState')".
  // dedupe 로 react/react-dom 을 앱 루트 1벌로 강제 (로컬 링크 DS 소비의 표준 fix).
  resolve: { dedupe: ["react", "react-dom"] },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    css: false,
  },
});
