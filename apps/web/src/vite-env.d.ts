/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_PVP_SERVER_URL?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
