import { createPageMetadata } from "@mvp/runtime/seo";
import type { Metadata } from "next";

export const vaultsSeoCopy = {
  title: "MVP Perps — Vaults",
  description:
    "Deposit into automated market-making and delta-neutral vaults. Each vault publishes its strategy, historical APY and total value locked. Fully server-rendered and readable without client JavaScript.",
} as const;

export const metadata: Metadata = createPageMetadata({
  title: vaultsSeoCopy.title,
  description: vaultsSeoCopy.description,
  path: "/vaults",
});
