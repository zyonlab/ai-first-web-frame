import type { Metadata } from "next";

export const referralsSeoCopy = {
  title: "MVP Perps — Referrals",
  description:
    "Invite traders and earn a share of their fees. Share your referral code, climb the tier ladder as referred volume grows, and track your rebate rate. Fully server-rendered and readable without client JavaScript.",
} as const;

export const metadata: Metadata = {
  title: referralsSeoCopy.title,
  description: referralsSeoCopy.description,
};
