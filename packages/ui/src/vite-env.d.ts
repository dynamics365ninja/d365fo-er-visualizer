/// <reference types="vite/client" />

interface ImportMetaEnv {
	/**
	 * Application (client) ID of the multi-tenant Entra registration this build
	 * signs in with. When set, an F&O connection profile only needs the
	 * environment URL — no per-customer app registration.
	 */
	readonly VITE_FNO_CLIENT_ID?: string;
}

declare module '*.css' {
	const css: string;
	export default css;
}