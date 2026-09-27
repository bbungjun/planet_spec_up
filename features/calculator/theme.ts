export type Theme = "light" | "dark";
export const THEME_STORAGE_KEY = "planet-ui-theme";

// Runs before the first paint. This preference is separate from character data.
export const THEME_INIT_SCRIPT = `(function(){var t='light';try{if(localStorage.getItem('${THEME_STORAGE_KEY}')==='dark')t='dark'}catch(e){}document.documentElement.dataset.theme=t})()`;
