import { Decision, Result, INDUSTRY_CONTEXT, Team } from '../types';

export function calculateRoundResults(
  teams: Team[],
  decisions: Decision[],
  previousResults: Result[],
  round: number,
  sessionTotalMarketSize?: number
): Result[] {
  let baseMarketDemand = sessionTotalMarketSize || 6000000; // Use customized base units or default to 6,000,000
  const results: Result[] = [];

  // 1. Dynamic Market Demand based on total industry promotion
  const totalIndustryProm = decisions
    .filter(d => d.round === round)
    .reduce((sum, d) => {
      const p = d.promotionAllocation;
      return sum + (p.events || 0) + (p.socialMedia || 0) + (p.tradeMagazines || 0) + (p.influencerEvents || 0);
    }, 0);

  const avgPromPerTeam = teams.length > 0 ? totalIndustryProm / teams.length : 0;
  // Marketing grows the overall category awareness
  const normalizedProm = Math.max(20000, avgPromPerTeam * 0.7);
  const demandStimulus = Math.min(1.4, 1 + Math.pow(normalizedProm / 6000000, 0.7) * 0.35);
  let totalMarketDemand = baseMarketDemand * demandStimulus;

  // 2. Stainless Steel Addressable Market (CRITICAL)
  let ssMarketShare = 0.07;
  if (round === 5) ssMarketShare = 0.20;
  if (round >= 6) ssMarketShare = 0.25; // Continuous growth
  totalMarketDemand *= ssMarketShare;

  if (round >= 5) {
    totalMarketDemand *= 1.5; // Significant market expansion
  }

  // Round 6: New Entrant Impact
  let entrantVolume = 0;
  if (round === 6) {
    // New entrant takes 1 lakh capacity (100,000 units)
    entrantVolume = 100000;
    totalMarketDemand = Math.max(0, totalMarketDemand - entrantVolume);
  }

  // Calculate scores for each team
  const teamScores = teams.map((team) => {
    const decision = decisions.find(d => d.teamId === team.id);

    if (!decision) {
      return {
        teamId: team.id,
        score: 0.05,
        pricing: 550,
        sourcing: 'Domestic' as const,
        totalProm: 0,
        costMultiplier: 1.0,
        satisfactionBonus: 0,
        capacity: 150000,
        fixedCosts: 2000000,
        salesForceCost: 500000,
        salesForceEfficiency: 1.0,
        strengths: [],
        weaknesses: ['No decision submitted'],
        explanation: 'Team did not submit any decisions for this round.'
      };
    }

    const segAlloc = decision.segmentAllocation || { residential: 33, commercial: 33, government: 34 };
    const chan = decision.distributionChannel || { influencers: 33, dealers: 33, direct: 34 };
    const price = decision.pricing || 550;

    // 1. Production Capacity Decision
    let capacity = 50000;
    let fixedCosts = 2000000;
    switch (decision.productionCapacityChoice) {
      case 'Small':
        capacity = 30000;
        fixedCosts = 1000000;
        break;
      case 'Medium':
        capacity = 50000;
        fixedCosts = 2000000;
        break;
      case 'Large':
        capacity = 100000;
        fixedCosts = 3500000;
        break;
    }

    let strengths: string[] = [];
    let weaknesses: string[] = [];

    // 2. Sales Force Strategy
    // Count: 5-25, Salary: 3L-16L (300,000 - 1,600,000)
    const sfCount = decision.salesForceCount || 5;
    const sfSalary = decision.salesForceSalary || 500000;

    let salesForceCost = sfCount * sfSalary;
    // Cap verification (though UI should handle it)
    if (salesForceCost > 8000000) {
      salesForceCost = 8000000;
      weaknesses.push('Salesforce budget exceeded cap (₹80L); strategy restricted.');
    }

    // Efficiency tied to salary (3L = 0.5, 16L = 1.7)
    const skillMultiplier = 0.5 + ((sfSalary - 300000) / 1300000) * 1.2;
    // Reach tied to count (5 = 0.85, 25 = 1.25)
    const reachMultiplier = 0.85 + ((sfCount - 5) / 20) * 0.4;

    let salesForceEfficiency = skillMultiplier * reachMultiplier;
    let b2bBonus = 1.0;
    let dealerBonus = 1.0;

    // Specific Segment/Channel Bonuses
    if (skillMultiplier > 1.2) {
      b2bBonus = 1.3;
      strengths.push('Expert B2B negotiations');
    } else if (skillMultiplier < 0.9) {
      b2bBonus = 0.7;
      weaknesses.push('Limited complex sales ability');
    }

    if (reachMultiplier > 1.1) {
      dealerBonus = 1.2;
      strengths.push('Extensive dealer coverage');
    } else if (reachMultiplier < 0.95) {
      dealerBonus = 0.8;
      weaknesses.push('Narrow market reach');
    }

    // A. Product Strategy Impact (Quality level)
    let productMultiplier = 1.0;
    let costMultiplier = 1.0;
    let satisfactionBonus = 0;

    switch (decision.productStrategy) {
      case 'Premium (high grade steel)':
        productMultiplier = 1.3;
        costMultiplier = 1.3;
        satisfactionBonus += 1.5;
        if (decision.sourcing === 'Domestic') {
          productMultiplier *= 0.9; // credibility gap
        }
        break;
      case 'Medium (Indian steel)':
        productMultiplier = 1.1;
        costMultiplier = 1.1;
        satisfactionBonus += 0.5;
        break;
      case 'Average':
        productMultiplier = 0.8;
        costMultiplier = 0.75;
        satisfactionBonus -= 1.2;
        break;
      case 'Product + Service (site supervision)':
        productMultiplier = 1.55;
        costMultiplier = 1.5;
        satisfactionBonus += 2.5;
        break;
    }

    // B. Sourcing Logic (Origin specific)
    let sourcingScoreMult = 1.0;
    let sourcingCostMult = 1.0;

    if (decision.sourcing === 'Imported') {
      sourcingScoreMult = 1.1;
      sourcingCostMult = round >= 4 ? 1.6 : 1.25;
    } else {
      // Domestic advantage in Government
      sourcingScoreMult = 1 + (segAlloc.government * 0.002);
    }

    // C. Segment Growth Multipliers
    const segmentGrowth = (segAlloc.residential * 1.27 + segAlloc.commercial * 1.22 + segAlloc.government * 1.05) / 100;

    // D. Normalized Channel–Segment Fit
    const resiFit = (chan.influencers / 100) * 1.7 + (chan.dealers / 100) * 0.3;
    const commFit = (chan.dealers / 100) * 1.25 + (chan.influencers / 100) * 0.4;
    const govtFit = (chan.direct / 100) * 1.2;

    // Apply sales force bonuses to channel fit
    const adjustedResiFit = (chan.influencers / 100) * 1.7 * b2bBonus + (chan.dealers / 100) * 0.3 * dealerBonus;
    const adjustedCommFit = (chan.dealers / 100) * 1.25 * dealerBonus + (chan.influencers / 100) * 0.4 * b2bBonus;
    const adjustedGovtFit = (chan.direct / 100) * 1.2 * b2bBonus;

    const rawFit = (segAlloc.residential / 100) * adjustedResiFit +
      (segAlloc.commercial / 100) * adjustedCommFit +
      (segAlloc.government / 100) * adjustedGovtFit;
    let channelSegmentFit = 0.9 + (rawFit * 0.3); // Range 0.9 to 1.2

    if (chan.influencers > 0) {
      channelSegmentFit *= (1 + (chan.influencers / 100) * 0.08);
    }

    // E. Promotion Effectiveness (Awareness vs Conversion)
    const prom = decision.promotionAllocation || { events: 0, socialMedia: 0, tradeMagazines: 0, influencerEvents: 0 };
    const totalPromRaw = (prom.events || 0) + (prom.socialMedia || 0) + (prom.tradeMagazines || 0) + (prom.influencerEvents || 0);

    // Hard Budget Cap Enforcement
    const effectiveProm = Math.min(totalPromRaw, INDUSTRY_CONTEXT.maxPromotionBudget);
    const promotionCapped = totalPromRaw > INDUSTRY_CONTEXT.maxPromotionBudget;
    if (promotionCapped) {
      weaknesses.push(`Promotion spend exceeded hard limit of ₹${(INDUSTRY_CONTEXT.maxPromotionBudget / 100000).toFixed(0)}L`);
    }

    let finalPromEffect = 0.15; // Minimum 15% effectiveness
    const diminishingReturnThreshold = 5000000;
    const cappedProm = Math.min(effectiveProm, diminishingReturnThreshold);
    const promReach = Math.min(1.2, Math.pow(cappedProm, 0.45) / 300);

    if (effectiveProm > 0) {
      const awareness = (prom.socialMedia || 0) * 0.6 + (prom.tradeMagazines || 0) * 0.8;
      const conversion = (prom.influencerEvents || 0) * 1.6 + (prom.events || 0) * 1.3;
      // Note: we use totalPromRaw for the ratio to penalize over-spending even if it's capped in effect
      const calculatedPromEffect = ((awareness * 0.4 + conversion * 0.6) / Math.max(1, cappedProm)) * promReach;
      finalPromEffect = Math.max(0.15, calculatedPromEffect);

      if (effectiveProm > diminishingReturnThreshold) {
        finalPromEffect *= 0.7; // inefficiency penalty
        weaknesses.push('Promotion budget facing diminishing returns (> 50L)');
      }

      const currentRoundTotalProm = decisions
        .filter(d => d.round === round)
        .reduce((sum, d) => {
          const p = d.promotionAllocation;
          const raw = (p.events || 0) + (p.socialMedia || 0) + (p.tradeMagazines || 0) + (p.influencerEvents || 0);
          return sum + Math.min(raw, INDUSTRY_CONTEXT.maxPromotionBudget);
        }, 0);

      const crowdingFactor = 1 - Math.min(0.2, currentRoundTotalProm / (teams.length * 7000000));
      finalPromEffect *= crowdingFactor;
    }

    // F. CPVC Conversion Barrier (Strengthened)
    let adoptionBarrier = 0.4; // Base difficulty
    if (decision.positioning.includes('Quality')) adoptionBarrier += 0.2;
    if (decision.productStrategy.includes('Premium')) adoptionBarrier += 0.15;
    if (decision.productStrategy.includes('Service')) adoptionBarrier += 0.3;

    if (segAlloc.residential > 50) adoptionBarrier -= 0.05;
    if (segAlloc.commercial > 50) adoptionBarrier += 0.05;
    if (segAlloc.government > 50) adoptionBarrier -= 0.1;

    if (round === 4 && decision.sourcing === 'Imported') adoptionBarrier *= 1.2;
    if (round === 5) adoptionBarrier += 0.18;
    adoptionBarrier = Math.min(0.85, Math.max(0.35, adoptionBarrier));

    // G. Price Sensitivity (Improved Impact)
    let priceFactor = 1.0;
    if (price > 800) {
      priceFactor = Math.max(0.05, 1 - (price - 800) / 150);
      if (price > 900) priceFactor *= 0.6;
      weaknesses.push('Pricing is significantly above market tolerance');
    } else if (price < 450) {
      priceFactor = 1.15 - (450 - price) / 600;
      strengths.push('Aggressive competitive pricing');
    } else {
      priceFactor = 1.1 - Math.abs(price - 550) / 600;
    }

    // Round 4+ External Event Impact on Imported
    if (round >= 4 && decision.sourcing === 'Imported') {
      sourcingScoreMult *= 0.6;
      priceFactor *= 0.75;
      if (round === 4) {
        weaknesses.push('Heavy impact from import duties');
      } else if (round === 5) {
        weaknesses.push('Import duties remain extremely high; cost of imported goods is surging');
      }
    }

    // H. Price-Positioning Alignment
    let pricePosAlignment = 1.0;
    if ((decision.positioning.includes('Quality') || decision.positioning.includes('Premium')) && price > 700) {
      pricePosAlignment = 1.2;
      strengths.push('Excellent price-positioning alignment');
    } else if (decision.positioning.includes('Competitive') && price < 500) {
      pricePosAlignment = 1.15;
      strengths.push('Strong value-for-money positioning');
    } else if ((decision.positioning.includes('Quality') && price < 450) || (decision.positioning.includes('Competitive') && price > 750)) {
      pricePosAlignment = 0.8; // Mismatch penalty
      weaknesses.push('Price-positioning mismatch');
    }

    // I. Government Entry Barrier
    let govtBarrier = 0.55;
    let trustFactor = 1.0;

    const lastRoundResults = previousResults.filter(r => r.round === round - 1);
    const prevResult = lastRoundResults.find(r => r.teamId === team.id);

    const govtIntensity = segAlloc.government / 100;
    govtBarrier *= (1 - govtIntensity * 0.2);

    if (segAlloc.government > 30) {
      if (decision.sourcing === 'Domestic') govtBarrier *= 0.8;
      govtBarrier = Math.min(0.8, govtBarrier);
      if (decision.sourcing === 'Imported') trustFactor = 0.75;

      if (segAlloc.government > 50 && decision.sourcing === 'Imported') {
        govtBarrier *= 0.8;
      }
      if (prevResult && segAlloc.government > 50 && prevResult.marketShare < 0.05) {
        govtBarrier *= 0.75; // no prior credibility
      }
      if (segAlloc.government > 60 && !prevResult) {
        govtBarrier *= 0.75; // strong entry barrier
      }
    }

    // J. Strategy Focus Reward
    const focus = Math.max(segAlloc.residential, segAlloc.commercial, segAlloc.government) / 100;
    const focusMultiplier = 0.9 + (focus * 0.2);

    // K. Channel Focus Reward
    const channelFocus = Math.max(chan.influencers, chan.dealers, chan.direct) / 100;
    const channelFocusMultiplier = 0.9 + (channelFocus * 0.15);

    // L. Product + Service Segment Fit
    let serviceFit = 1.0;
    let premiumLimit = 1.0;

    // M. Experience & Satisfaction Effects
    let experienceBoost = 1.0;
    if (prevResult) {
      experienceBoost = 1
        + Math.min(0.06, prevResult.marketShare * 0.06)
        + ((prevResult.customerSatisfaction - 5) * 0.012);
      if (prevResult.marketShare < 0.05) {
        experienceBoost *= 0.93;
      }
      if (prevResult.marketShare > 0.25) {
        experienceBoost *= 0.97; // complexity drag
      }
    }

    if (decision.productStrategy.includes('Service') || decision.productStrategy.includes('Premium')) {
      premiumLimit = (segAlloc.commercial * 0.9 + segAlloc.residential * 0.8 + segAlloc.government * 0.5) / 100;
      if (decision.productStrategy.includes('Service')) {
        serviceFit = (segAlloc.commercial * 1.15 + segAlloc.residential * 1.1 + segAlloc.government * 0.7) / 100;
        // Scalability friction: Large scale -> service harder to maintain
        let serviceScalePenalty = 1.05;
        if (capacity > 120000) {
          serviceScalePenalty -= Math.min(0.15, (capacity - 120000) / 200000);
        }
        serviceFit *= serviceScalePenalty;
      }
    }

    // N. Competition Factor
    const competitionFactor = 1 / (1 + teams.length * 0.1);

    // Final Scoring Pipeline
    const randomness = 0.97 + Math.random() * 0.06;
    let brandTrust = Math.min(0.95, 0.85 + (round * 0.02));

    let cpvcPressure = price < 600 ? 0.85 : 0.95;
    if (round === 5) {
      cpvcPressure += 0.05; // CPVC weaker
    }
    cpvcPressure = Math.min(1.0, cpvcPressure);
    cpvcPressure *= (1 - (segAlloc.residential / 100) * 0.07);

    let foreignPressure = 1.0;
    if (price > 700) {
      foreignPressure = 0.88 - Math.min(0.15, (price - 700) / 800);
      foreignPressure *= (1 - (segAlloc.commercial / 100) * 0.1);
      foreignPressure = Math.max(0.75, foreignPressure);
    }

    let combinedCompetition = cpvcPressure * foreignPressure;
    combinedCompetition = 0.85 + (combinedCompetition - 0.85) * 0.7;

    let finalScore = productMultiplier *
      sourcingScoreMult *
      segmentGrowth *
      channelSegmentFit *
      finalPromEffect *
      adoptionBarrier *
      priceFactor *
      pricePosAlignment *
      govtBarrier *
      trustFactor *
      focusMultiplier *
      channelFocusMultiplier *
      serviceFit *
      premiumLimit *
      experienceBoost *
      competitionFactor *
      brandTrust *
      combinedCompetition *
      salesForceEfficiency * // Apply sales force efficiency
      randomness;

    finalScore = Math.pow(finalScore, 0.85);
    if (finalScore < 0.02) finalScore *= 0.5;

    if (round === 5 && prevResult) {
      const challengerBoost = Math.max(0, (0.12 - prevResult.marketShare)) * 0.25;
      finalScore *= (1 + challengerBoost);
    }

    // Generate Explanation
    let explanation = "";
    if (priceFactor < 0.8) explanation += "High pricing severely limited market reach. ";
    if (channelSegmentFit < 0.95) explanation += "Poor alignment between chosen segments and distribution channels. ";
    if (finalPromEffect < 0.3) explanation += "Inefficient promotion spending or low awareness. ";
    if (salesForceEfficiency < 1.0) explanation += "Sales force strategy was not optimized for the chosen channels. ";
    if (explanation === "") explanation = "Solid strategic alignment across pricing, product, and channels.";

    return {
      teamId: team.id,
      score: Math.max(0.001, finalScore),
      pricing: price,
      sourcing: decision.sourcing || 'Domestic',
      totalProm: effectiveProm,
      costMultiplier: costMultiplier * sourcingCostMult,
      satisfactionBonus,
      focusMultiplier,
      experienceBoost,
      capacity,
      fixedCosts,
      salesForceCost,
      salesForceEfficiency,
      productMultiplier,
      serviceFit,
      strengths,
      weaknesses,
      explanation
    };
  });

  const totalScore = teamScores.reduce((sum, t) => sum + t.score, 0);

  // Calculate market share and metrics
  teamScores.forEach((t) => {
    const marketShare = totalScore > 0 ? t.score / totalScore : 1 / teamScores.length;

    if (round === 1) {
      results.push({
        teamId: t.teamId,
        sessionId: teams[0]?.sessionId || '',
        round: round,
        volume: 0,
        revenue: 0,
        profit: 0,
        marketShare: marketShare,
        actualMarketShare: 0, // No actual sales in round 1
        customerSatisfaction: Math.min(10, Math.max(1, 5 + t.satisfactionBonus)),
        rank: 0,
        forecastedDemand: 0,
        installedCapacity: t.capacity,
        capacityUtilization: 0,
        breakEvenVolume: 0,
        lostSales: 0,
        salesForceEfficiency: t.salesForceEfficiency,
        strengths: t.strengths,
        weaknesses: t.weaknesses,
        explanation: t.explanation,
        variableCosts: 0,
        contributionMargin: 0,
        fixedCosts: t.fixedCosts,
        salesForceCosts: t.salesForceCost,
        promotionCosts: t.totalProm,
        unitPrice: t.pricing,
        unitCost: 0
      });
      return;
    }

    // Capacity Constraint
    const capacity = t.capacity;
    const potentialVolume = totalMarketDemand * marketShare;
    const volume = Math.min(capacity, potentialVolume);
    const lostSales = Math.max(0, potentialVolume - capacity);

    if (lostSales > 0) {
      t.weaknesses.push(`Lost ${Math.round(lostSales).toLocaleString()} units due to capacity constraints`);
    }

    const revenue = volume * t.pricing;

    // Cost calculation
    let unitCost = 350 * t.costMultiplier;
    const utilization = volume / capacity;

    // Utilization penalties/bonuses
    if (utilization < 0.5) {
      unitCost *= 1.15; // Underutilization penalty
      t.weaknesses.push('High unit costs due to underutilization (< 50%)');
    } else if (utilization >= 0.7 && utilization <= 0.9) {
      unitCost *= 0.92; // Efficiency bonus
      t.strengths.push('Optimal capacity utilization (70-90%)');
    } else if (utilization > 0.95) {
      unitCost *= 1.1; // Overutilization penalty (overtime, maintenance)
      t.weaknesses.push('Efficiency loss due to overutilization (> 95%)');
    }

    if (volume > capacity * 0.6) {
      unitCost *= 0.97; // economies of scale
    }

    const totalFixedCosts = t.fixedCosts + t.salesForceCost;
    const totalCosts = (volume * unitCost) + t.totalProm + totalFixedCosts;
    const profit = revenue - totalCosts;

    // Break-even volume: Fixed Costs / (Price - Variable Cost)
    const contributionMargin = t.pricing - unitCost;
    const breakEvenVolume = contributionMargin > 0 ? totalFixedCosts / contributionMargin : capacity * 2;

    // Enhanced Satisfaction Logic
    let priceFairness = 1.0;
    if (t.pricing > 900) priceFairness = 0.5;
    if (t.pricing < 400) priceFairness = 0.75;

    const satisfaction = Math.min(10, Math.max(1, (4 + t.productMultiplier * 2 + t.serviceFit * 2) * priceFairness + t.satisfactionBonus));

    // Actual market share = units actually sold / total market demand
    const actualMarketShare = totalMarketDemand > 0
      ? Math.min(1, Math.round(volume) / totalMarketDemand)
      : 0;

    results.push({
      teamId: t.teamId,
      sessionId: teams[0]?.sessionId || '',
      round: round,
      volume: Math.round(volume),
      revenue: Math.round(revenue),
      profit: Math.round(profit),
      marketShare: marketShare,
      actualMarketShare: parseFloat(actualMarketShare.toFixed(4)),
      customerSatisfaction: parseFloat(satisfaction.toFixed(1)),
      rank: 0,
      forecastedDemand: Math.round(potentialVolume),
      installedCapacity: capacity,
      capacityUtilization: parseFloat((utilization * 100).toFixed(1)),
      breakEvenVolume: Math.round(breakEvenVolume),
      lostSales: Math.round(lostSales),
      salesForceEfficiency: t.salesForceEfficiency,
      strengths: t.strengths,
      weaknesses: t.weaknesses,
      explanation: t.explanation,
      variableCosts: Math.round(volume * unitCost),
      contributionMargin: Math.round(revenue - (volume * unitCost)),
      fixedCosts: Math.round(t.fixedCosts),
      salesForceCosts: Math.round(t.salesForceCost),
      promotionCosts: Math.round(t.totalProm),
      unitPrice: t.pricing,
      unitCost: parseFloat(unitCost.toFixed(2))
    });
  });

  // Calculate ranks
  results.sort((a, b) => b.profit - a.profit);
  results.forEach((r, index) => {
    r.rank = index + 1;
  });

  return results;
}
