// 极简 TS ESM 加载器（Node 20 module.register 版）：仅够跑本地纯逻辑测试，
// 把 @/ 别名解析到 src，并用 typescript 转译 .ts。
import { fileURLToPath, pathToFileURL } from 'node:url'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve as pathResolve } from 'node:path'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const here = dirname(fileURLToPath(import.meta.url))
const srcRoot = pathResolve(here, '..', 'src')

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    const base = pathResolve(srcRoot, specifier.slice(2))
    try {
      return await nextResolve(pathToFileURL(base).href, context)
    } catch {
      return await nextResolve(pathToFileURL(base + '.ts').href, context)
    }
  }
  // 支持源码里无扩展名的相对导入（TS/bundler 风格，如 './seed'）
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && !/\.[cm]?[jt]s$/.test(specifier)) {
    try {
      return await nextResolve(specifier, context)
    } catch {
      const parent = context.parentURL ? fileURLToPath(context.parentURL) : here
      const base = pathResolve(dirname(parent), specifier)
      return await nextResolve(pathToFileURL(base + '.ts').href, context)
    }
  }
  return nextResolve(specifier, context)
}

export async function load(url, context, nextLoad) {
  const clean = url.split('?')[0]
  if (clean.endsWith('.ts')) {
    const path = fileURLToPath(clean)
    const source = readFileSync(path, 'utf8')
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2020,
        isolatedModules: true,
        esModuleInterop: true,
      },
      fileName: path,
    })
    return { format: 'module', source: outputText, shortCircuit: true }
  }
  return nextLoad(url, context)
}
