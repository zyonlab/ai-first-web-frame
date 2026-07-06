# Optimization Findings

Status: warn

Traces: no runtime traces found; trace-based rules skipped

## INFO (3)

### ssg: recommendations

Slot "recommendations" has no declared dependencies and may not need dynamic SSR.

- Location: manifestPath=apps/page-home/src/manifest.slots.json, slotName=recommendations, fragmentName=recommendation-widget
- Evidence: none
- Recommendation: Change the slot strategy to static, isr, or cached-ssr if its content is deterministic.

### ssg: recommendations

Slot "recommendations" has no declared dependencies and may not need dynamic SSR.

- Location: manifestPath=apps/page-product/src/manifest.slots.json, slotName=recommendations, fragmentName=recommendation-widget
- Evidence: none
- Recommendation: Change the slot strategy to static, isr, or cached-ssr if its content is deterministic.

### ssg: price-panel

Slot "price-panel" has no declared dependencies and may not need dynamic SSR.

- Location: manifestPath=apps/page-product/src/manifest.slots.json, slotName=price-panel, fragmentName=price-panel
- Evidence: none
- Recommendation: Change the slot strategy to static, isr, or cached-ssr if its content is deterministic.
