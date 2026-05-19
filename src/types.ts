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
  isCapacityLocked?: boolean;
  totalMarketSize?: number;
}

export interface Team {
  id: string;
  sessionId: string;
  name: string;
  members: string[];
  viewers?: string[];  // UIDs of players in view-only mode (joined with an existing team name)
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
  salesForceCount: number;
  salesForceSalary: number;
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
  marketShare: number;        // Potential demand capture (score-based share of forecasted demand)
  actualMarketShare?: number; // Actual units sold / total market demand (optional – backward compatible)
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
  // P&L Components
  variableCosts: number;
  contributionMargin: number;
  fixedCosts: number;
  salesForceCosts: number;
  promotionCosts: number;
  unitPrice: number;
  unitCost: number;
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
  salesForceSizeOptions: ['Small', 'Medium', 'Large'],
  salesForceSkillOptions: ['Low', 'Medium', 'High'],
  pricingRange: { min: 300, max: 1000 },
  promotionBudget: 5000000, // Initial default
  maxPromotionBudget: 8000000, 
};
