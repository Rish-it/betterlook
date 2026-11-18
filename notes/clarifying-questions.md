# Parked: clarifying questions before a big build

Status: parked. Not built until it has its own evals.

## What we saw

In Emergent, a broad prompt for a landing page for a real brand did not start building. The agent first showed a card of short questions with suggested answers (audience, sections, style). One answer steered the build to "inspired by the brand, with an original name" instead of using the real brand's name and marks.

## Why it is parked

- It is agent behaviour, not UI: it needs a new tool (ask the designer, wait for answers) and a rule for when a request is too broad to start.
- It changes what a turn is, so it needs its own eval tasks and pass criteria first, written by the team.
- The brand case overlaps with a policy question (real brands, trademarks) that the team decides.

## When to pick it up

When the team has written eval tasks for broad requests and decided the brand policy.
