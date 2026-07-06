/**
 * Minimal base reset + global base styles, injected once by the shell.
 *
 * Per doc 04 §5.2 the framework does NOT ship Tailwind Preflight; this reset is
 * the single global-selector block for the whole app, keeping the
 * `css-budget-check` `globalSelectors`/`duplicatedRules` counts low. It uses the
 * design-system CSS variables (`--mvp-*`) for base colors and fonts so it
 * themes automatically, and logical properties where practical so a future
 * `dir="rtl"` mirrors (doc 05 §8).
 */
export const baseResetCss = `*,*::before,*::after{box-sizing:border-box;}
*{margin:0;}
html{-webkit-text-size-adjust:100%;text-size-adjust:100%;line-height:1.5;-moz-tab-size:4;tab-size:4;}
body{min-height:100vh;font-family:var(--mvp-font-body,ui-serif,Georgia,serif);color:var(--mvp-color-ink,#15171a);background:var(--mvp-color-surface-0,#fbfaf7);-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;}
img,picture,video,canvas,svg{display:block;max-width:100%;}
input,button,textarea,select{font:inherit;color:inherit;}
button{cursor:pointer;background:none;border:none;padding:0;}
p,h1,h2,h3,h4,h5,h6{overflow-wrap:break-word;}
a{color:inherit;text-decoration:none;}
ul[role="list"],ol[role="list"]{list-style:none;padding-inline:0;}
table{border-collapse:collapse;border-spacing:0;}
:where([data-mono]),.mono{font-family:var(--mvp-font-mono,ui-monospace,monospace);font-variant-numeric:tabular-nums;}
:where(:focus-visible){outline:2px solid var(--mvp-color-accent,#0f766e);outline-offset:2px;}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:0.01ms!important;animation-iteration-count:1!important;transition-duration:0.01ms!important;scroll-behavior:auto!important;}}`;
