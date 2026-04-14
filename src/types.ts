export type UserRole = 'instructor' | 'student';

export interface UserProfile {
  uid: string;
  email: string;
  role: UserRole;
  displayName: string;
}

export interface Session {
  id: string;
  instructorId: string;
  name: string;
  joinCode: string;
  currentRound: number;
  status: 'waiting' | 'active' | 'completed';
  isAnalysisPhase: boolean;
  createdAt: any;
  isLocked: boolean;
}

export interface Team {
  id: string;
  sessionId: string;
  name: string;
  members: string[];
  createdAt: any;
}

export interface SegmentAllocation {
  residential: number;
  commercial: number;
  government: number;
}

export interface DistributionChannel {
  influencers: number;
  dealers: number;
  direct: number;
}

export interface PromotionAllocation {
  events: number;
  socialMedia: number;
  tradeMagazines: number;
  influencerEvents: number;
}

export interface Decision {
  id?: string;
  teamId: string;
  sessionId: string;
  round: number;
  segmentAllocation: SegmentAllocation;
  positioning: string;
  productStrategy: string;
  pricing: number;
  distributionChannel: DistributionChannel;
  promotionAllocation: PromotionAllocation;
  sourcing: 'Domestic' | 'Imported';
  productionCapacityChoice: 'Small' | 'Medium' | 'Large';
  salesForceStrategy: string;
  overallStrategy: string;
  assumptions?: string;
  submittedAt: any;
}

export interface Result {
  id?: string;
  teamId: string;
  sessionId: string;
  round: number;
  volume: number;
  revenue: number;
  profit: number;
  marketShare: number;
  customerSatisfaction: number;
  rank: number;
  // New metrics
  forecastedDemand: number;
  installedCapacity: number;
  capacityUtilization: number;
  breakEvenVolume: number;
  lostSales: number;
  salesForceEfficiency: number;
  strengths: string[];
  weaknesses: string[];
  explanation: string;
}

export const INDUSTRY_CONTEXT = {
  marketOverview: {
    cpvc: 0.85,
    iron: 0.08,
    stainless: 0.07,
  },
  segments: ['Residential', 'Commercial', 'Government Contracts'],
  positioning: ['Quality-driven', 'Emotional (safety, health)', 'Competitive (price-focused)'],
  productStrategy: ['Premium (high grade steel)', 'Medium (Indian steel)', 'Average', 'Product + Service (site supervision)'],
  capacityOptions: ['Small', 'Medium', 'Large'],
  salesForceOptions: [
    'Small Highly Trained B2B Force',
    'Medium Semi-Trained Mixed Force',
    'Large Low-Trained Frontline Force',
    'Large Highly Trained Force'
  ],
  pricingRange: { min: 300, max: 1000 },
  promotionBudget: 5000000, // 50 Lakhs
};
