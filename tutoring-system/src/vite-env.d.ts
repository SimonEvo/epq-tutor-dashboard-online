/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 部署时间，由 deploy.py 在 build 前注入（本地 dev 为空） */
  readonly VITE_BUILD_TIME?: string
  /** 部署签名：部署人 + git 短 hash，由 deploy.py 注入 */
  readonly VITE_BUILD_SIG?: string
  /** 部署时所在的 git 分支，由 deploy.py 注入（本地 dev 为空） */
  readonly VITE_BUILD_BRANCH?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
