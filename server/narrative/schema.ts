import { z } from "zod";

const ClientStorySchema = z.object({
  clientNames: z.string().describe("Full names of the client(s), e.g. 'Dana and Luis Ortega'. For a builder, the company and its sales manager."),
  backstory: z.string().describe("2-4 sentences: who they are and how they got here."),
  motivationStory: z.string().describe("2-3 sentences explaining why they are buying or selling now, consistent with the motivation key and urgency."),
  whatTheyveToldYou: z.string().describe("A paragraph of what the client told their agent in private, in the client's voice, including the limits they gave."),
  softSpots: z.array(z.string()).describe("2-4 things the client would trade on or that would win them over."),
  nonNegotiables: z.array(z.string()).describe("1-3 hard lines."),
  quirks: z.array(z.string()).describe("1-3 personality traits that affect how they negotiate."),
});

export const NarrativeSchema = z.object({
  listingHeadline: z.string().describe("MLS-style headline, under 80 characters."),
  listingRemarks: z.string().describe("Public MLS remarks, 90-160 words, in a listing agent's voice. Honest but upbeat."),
  neighborhood: z.string().describe("2-3 sentences about the neighborhood or area."),
  marketSnapshot: z.string().describe("2-3 sentences describing current local market conditions, consistent with the market numbers."),
  sellerStory: ClientStorySchema,
  buyerStory: ClientStorySchema,
  opposingAgent: z.object({
    name: z.string(),
    brokerage: z.string().describe("A fictional local brokerage name."),
    yearsExperience: z.number().int(),
    dealsPerYear: z.number().int(),
    voice: z.string().describe("How this agent talks and negotiates, consistent with their temperament. 2-3 sentences."),
    signaturePhrases: z.array(z.string()).describe("3-5 short phrases this agent tends to use."),
    publicBio: z.string().describe("2 sentences anyone could find online about this agent."),
  }),
  openingSituation: z.object({
    buyer_agent: z.string().describe("Second person, for the user as the buyer's agent: what has happened so far and that they are about to write an offer. 2-4 sentences."),
    seller_agent: z.string().describe("Second person, for the user as the listing agent: what has happened so far and that an offer is about to arrive from the opposing buyer's agent. 2-4 sentences."),
  }),
});

export type NarrativeOutput = z.infer<typeof NarrativeSchema>;
