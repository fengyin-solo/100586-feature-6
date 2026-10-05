// 测试入口：先在专用线程注册 TS 钩子，再加载用例。
import { register } from 'node:module'

register(new URL('./ts-hooks.mjs', import.meta.url))
await import(new URL('./run-tests.mjs', import.meta.url))
