# OnePick MVP visual direction

Reference: the “대량 데이터 수집 전략” conversation and its ONE PICK · 나의 단 하나 mockup (Site `appgprj_6aa7fca80fec81919827a633894d2b2b`).

Use a quiet, light interface with a clear primary action. The home page leads with “많은 것보다, 마음에 드는 하나.” and the user's collection, with an adjacent “원픽 등록” button.

- Background: `#F5F6F8`; white cards with `#E3E5EA` borders.
- Primary accent: `#4945ED`; subtle selected surfaces: `#EFEEFF`.
- Text: `#202124`; secondary text: `#747985`.
- Brand: an indigo rounded square with a white `1`, followed by `ONE PICK`.
- Collection cards use category labels, existing representative images, item names and personal reasons. “MY PICK” is reserved for the signed-in user's own selections.
- The dashed add card remains an actionable entry to the existing item finder.
- Desktop collections use three columns, medium screens two, and small screens one. Forms stay narrow enough to read comfortably.
- Use actual database content and administrator-controlled categories. Mockup examples and sample counts are not production data.
- Keep existing authentication, request/approval, Pick, profile and administration routes intact. Future screens should follow this palette and avoid decorative sections without a clear purpose.

Shared tokens live in `mobile/src/constants/onepick.ts`. Native navigation and web branding use the same palette; existing screen styles are aligned with those values.
