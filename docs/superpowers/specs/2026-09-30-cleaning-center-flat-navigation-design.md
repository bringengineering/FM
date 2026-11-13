# Cleaning Center flat page navigation design

## Purpose
Make all supplied Cleaning Center screens individually discoverable from the Cleaning Center folder. Each menu item opens one route-specific page, so operators do not need to hunt through collapsed category groups.

## User experience
Keep the existing 34-screen registry, titles, routes, data sources, and write guards. Render the 34 entries as one flat list directly beneath the Cleaning Center folder, in reference order. Each entry keeps its number and Korean label, accessible name, active state, and click behavior. The list scrolls inside the sidebar when it is taller than the window; unrelated CRM navigation and the Cleaning Center page content are unchanged.

## Data and behavior
The registry remains the single source for page identity and destination. The same render dispatcher continues to render one dedicated page per selected route. This change affects only navigation structure and styling, not Firestore data, actions, or production state.

## Verification
Test that the list contains each of the 34 destinations exactly once as a direct child, contains no nested category disclosures, and maintains unique accessible names and active selection. Run the Cleaning Center page tests and the full desktop CRM suite. Capture the running interface to verify the sidebar scrolls and selecting destinations changes the page.
