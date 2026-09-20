/**
 * recommendation-widget SSR fragment service.
 *
 * Every HTTP behavior — `GET /` demo page, `/health`, `/ready`, `/metrics`,
 * `/manifest`, `/assets`, `/budget`, `POST /render` envelope validation,
 * request metrics and trace export — lives in `@mvp/fragment-host`. This file
 * is only the adapter that names this fragment and hands the host its
 * manifest, budget, render function and demo request, so a change to the
 * fragment HTTP contract is one edit in the host instead of fourteen here.
 */

import {
  type BuildFragmentServerOptions,
  createFragmentServer,
  isProcessEntry,
  startFragmentServer,
} from "@mvp/fragment-host";
import { recommendationWidgetBudget } from "./budget";
import { recommendationWidgetManifest } from "./manifest";
import { renderRecommendationWidget } from "./render";

export const SERVICE_NAME = "recommendation-widget";
const DEFAULT_PORT = 4202;

export function buildServer(options: BuildFragmentServerOptions = {}) {
  return createFragmentServer({
    serviceName: SERVICE_NAME,
    port: DEFAULT_PORT,
    manifest: recommendationWidgetManifest,
    budget: recommendationWidgetBudget,
    render: renderRecommendationWidget,
    demo: { ctx: { locale: "en-US" }, props: { scene: "home", limit: 3 } },
    ...options,
  });
}

if (isProcessEntry(import.meta.url)) {
  await startFragmentServer(buildServer(), {
    serviceName: SERVICE_NAME,
    port: DEFAULT_PORT,
  });
}
