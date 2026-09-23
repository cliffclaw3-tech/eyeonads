// Fictional teaching fixtures, not observed competitor ads or performance claims.
export const competitorExamples = [
  ['cedar', 'Cedar Home Studio', 'Open house', 'Tour this three-bedroom home Saturday, 1–3 PM. View the floor plan before your visit.'],
  ['harbor', 'Harbor Property Group', 'Seller guide', 'Planning to sell? Request our room-by-room preparation checklist.'],
  ['ridge', 'Ridge Realty Workshop', 'Market update', 'Explore this month’s local listing trends and ask how they relate to your plans.'],
  ['maple', 'Maple House Collective', 'Virtual tour', 'Walk through the kitchen and living spaces in our virtual property tour.'],
  ['stone', 'Stone Path Homes', 'Buyer education', 'Download a plain-language guide to the steps from offer to closing.'],
  ['willow', 'Willow Property Studio', 'Property details', 'Discover a covered patio, dedicated office and two-car garage. Request the full feature sheet.'],
  ['birch', 'Birch Realty Lab', 'Consultation', 'Bring your property questions to a no-obligation planning conversation.'],
  ['meadow', 'Meadow Home Group', 'Listing alert', 'Choose your price range and property features to receive matching listing updates.'],
  ['elm', 'Elm Property Collective', 'Community guide', 'Compare public transit routes, parks and shopping locations with our area resource guide.'],
  ['oak', 'Oak Home Workshop', 'Seller process', 'Learn how photography, property details and showing preparation fit into a listing plan.'],
].map(([id, name, angle, copy]) => ({ id, name, angle, copy }));
export function competitiveBrief(id: string, draft: string) {
  const example = competitorExamples.find(e => e.id === id);
  if (!example) throw new Error('Choose an example');
  return `Fictional competitor study: ${example.name}\nAngle: ${example.angle}\nExample: ${example.copy}\nYour draft: ${draft || 'Not supplied'}\nNext: compare the offer, supporting evidence and call to action. Verify all claims and disclosures before publishing.`;
}
