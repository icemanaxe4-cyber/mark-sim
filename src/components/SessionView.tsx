import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { doc, onSnapshot, collection, query, where, addDoc, serverTimestamp, updateDoc, getDocs, writeBatch } from 'firebase/firestore';
import { db, auth, handleFirestoreError, OperationType } from '../firebase';
import { Session, UserProfile, Team, Decision, Result, INDUSTRY_CONTEXT } from '../types';
import { Loader2, ChevronLeft, Lock, Unlock, Play, BarChart3, Users, AlertCircle, Info, TrendingUp, DollarSign, PieChart, Award, Trophy, ChevronRight } from 'lucide-react';
import { cn } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { calculateRoundResults } from '../services/simulationEngine';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, BarChart, Bar, Cell } from 'recharts';

import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';

export default function SessionView({ user }: { user: UserProfile }) {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [session, setSession] = useState<Session | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [myTeam, setMyTeam] = useState<Team | null>(null);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const exportToExcel = () => {
    const wsData = results.map(r => ({
      Round: r.round,
      Team: teams.find(t => t.id === r.teamId)?.name || r.teamId,
      Volume: r.volume,
      Revenue: r.revenue,
      Profit: r.profit,
      MarketShare: `${(r.marketShare * 100).toFixed(2)}%`,
      Rank: r.rank
    }));
    const ws = XLSX.utils.json_to_sheet(wsData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Results");
    XLSX.writeFile(wb, `${session?.name}_Results.xlsx`);
  };

  const exportToPDF = async () => {
    const element = document.getElementById('session-content');
    if (!element) return;
    
    setLoading(true);
    try {
      // Ensure we are at the top of the page for capture
      window.scrollTo(0, 0);
      
      const canvas = await html2canvas(element, {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: '#f8fafc',
        windowWidth: element.scrollWidth,
        windowHeight: element.scrollHeight
      });
      
      const imgData = canvas.toDataURL('image/jpeg', 0.95);
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
      
      // If content is longer than one page, we might need to handle it, 
      // but for now let's try to fit it or at least fix the basic failure.
      pdf.addImage(imgData, 'JPEG', 0, 0, pdfWidth, pdfHeight);
      pdf.save(`${session?.name}_Summary.pdf`);
    } catch (err) {
      console.error("PDF Export failed:", err);
      alert("Failed to export PDF. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!sessionId) return;

    // 1. Listen to session
    const sessionUnsubscribe = onSnapshot(doc(db, 'sessions', sessionId), (doc) => {
      if (doc.exists()) {
        setSession({ 
          id: doc.id, 
          ...doc.data(),
          isAnalysisPhase: doc.data()?.isAnalysisPhase ?? false
        } as Session);
      } else {
        navigate('/');
      }
    });

    // 2. Listen to teams
    const teamsQuery = query(collection(db, 'teams'), where('sessionId', '==', sessionId));
    const teamsUnsubscribe = onSnapshot(teamsQuery, (snapshot) => {
      const teamData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Team));
      setTeams(teamData);
      
      const foundMyTeam = teamData.find(t => t.members.includes(user.uid));
      setMyTeam(foundMyTeam || null);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'teams');
    });

    // 3. Listen to decisions
    const decisionsQuery = query(collection(db, 'decisions'), where('sessionId', '==', sessionId));
    const decisionsUnsubscribe = onSnapshot(decisionsQuery, (snapshot) => {
      setDecisions(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Decision)));
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'decisions');
    });

    // 4. Listen to results
    const resultsQuery = query(collection(db, 'results'), where('sessionId', '==', sessionId));
    const resultsUnsubscribe = onSnapshot(resultsQuery, (snapshot) => {
      setResults(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Result)));
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'results');
    });

    setLoading(false);
    return () => {
      sessionUnsubscribe();
      teamsUnsubscribe();
      decisionsUnsubscribe();
      resultsUnsubscribe();
    };
  }, [sessionId, user.uid, navigate]);

  if (loading || !session) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  const isInstructor = user.role === 'instructor';
  const currentRoundDecisions = decisions.filter(d => d.round === session.currentRound);
  const hasSubmitted = myTeam ? currentRoundDecisions.some(d => d.teamId === myTeam.id) : false;

  return (
    <div className="min-h-screen bg-slate-50 pb-12">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate(isInstructor ? '/instructor' : '/student')}
              className="p-2 text-slate-500 hover:bg-slate-100 rounded-lg transition-all"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <div>
              <h1 className="text-lg font-bold text-slate-900">{session.name}</h1>
              <p className="text-xs text-slate-500">Round {session.currentRound} of 5 • {session.status}</p>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            {isInstructor && (
              <>
                <button onClick={exportToExcel} className="hidden sm:flex items-center gap-2 bg-slate-100 text-slate-700 px-3 py-1.5 rounded-lg hover:bg-slate-200 transition-all text-sm font-medium">
                  Excel
                </button>
                <button onClick={exportToPDF} className="hidden sm:flex items-center gap-2 bg-slate-100 text-slate-700 px-3 py-1.5 rounded-lg hover:bg-slate-200 transition-all text-sm font-medium">
                  PDF
                </button>
                <InstructorControls session={session} teams={teams} decisions={decisions} results={results} />
              </>
            )}
            <div className="hidden sm:flex items-center gap-2 bg-blue-50 px-3 py-1.5 rounded-lg border border-blue-100">
              <Users className="h-4 w-4 text-blue-600" />
              <span className="text-sm font-semibold text-blue-700">{teams.length} Teams</span>
            </div>
            {!isInstructor && myTeam && results.some(r => r.teamId === myTeam.id) && (
              <div className="flex items-center gap-2 bg-indigo-50 px-3 py-1.5 rounded-lg border border-indigo-100">
                <PieChart className="h-4 w-4 text-indigo-600" />
                <span className="text-sm font-bold text-indigo-700">
                  MS: {(results.filter(r => r.teamId === myTeam.id).sort((a, b) => b.round - a.round)[0]?.marketShare * 100).toFixed(1)}%
                </span>
              </div>
            )}
          </div>
        </div>
      </header>

      <main id="session-content" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Round Info Banner */}
        <RoundInfoBanner round={session.currentRound} />

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 mt-8">
          {/* Main Content Area */}
          <div className="lg:col-span-8 space-y-8">
            {session.currentRound === 1 && !isInstructor && !hasSubmitted && !session.isAnalysisPhase && (
              <CompetitionBenchmark />
            )}

            {!isInstructor && session.status === 'active' && !hasSubmitted && !session.isAnalysisPhase && (
              <DecisionForm session={session} team={myTeam!} decisions={decisions} />
            )}

            {!isInstructor && session.status === 'active' && session.isAnalysisPhase && (
              <div className="bg-blue-50 rounded-2xl p-8 shadow-sm border border-blue-200 text-center">
                <Info className="h-8 w-8 text-blue-600 mx-auto mb-4" />
                <h3 className="text-lg font-bold text-blue-900 mb-2">Analysis Phase</h3>
                <p className="text-blue-700">The round has ended. Please review the results below. The instructor will start the next round shortly.</p>
              </div>
            )}

            {(!isInstructor && (hasSubmitted || session.status === 'completed')) && (
              <TeamResults team={myTeam!} results={results} round={session.currentRound} decisions={decisions} isAnalysisPhase={session.isAnalysisPhase} />
            )}

            {isInstructor && (
              <InstructorOverview session={session} teams={teams} decisions={decisions} results={results} />
            )}
          </div>

          {/* Sidebar Area */}
          <div className="lg:col-span-4 space-y-8">
            {!isInstructor && session.status === 'active' && !hasSubmitted && session.currentRound >= 3 && (
              <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
                <h3 className="text-lg font-bold text-slate-900 mb-4">Previous Round Performance</h3>
                {results.find(r => r.teamId === myTeam?.id && r.round === session.currentRound - 1) ? (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="p-3 bg-blue-50 rounded-xl">
                        <p className="text-xs text-blue-600 font-semibold uppercase">Market Share</p>
                        <p className="text-xl font-bold text-blue-900">
                          {(results.find(r => r.teamId === myTeam?.id && r.round === session.currentRound - 1)?.marketShare! * 100).toFixed(1)}%
                        </p>
                      </div>
                      <div className="p-3 bg-green-50 rounded-xl">
                        <p className="text-xs text-green-600 font-semibold uppercase">Volume</p>
                        <p className="text-xl font-bold text-green-900">
                          {results.find(r => r.teamId === myTeam?.id && r.round === session.currentRound - 1)?.volume.toLocaleString()}m
                        </p>
                      </div>
                      <div className="p-3 bg-indigo-50 rounded-xl">
                        <p className="text-xs text-indigo-600 font-semibold uppercase">Revenue</p>
                        <p className="text-xl font-bold text-indigo-900">
                          ₹{(results.find(r => r.teamId === myTeam?.id && r.round === session.currentRound - 1)?.revenue! / 10000000).toFixed(1)}Cr
                        </p>
                      </div>
                      <div className="p-3 bg-purple-50 rounded-xl">
                        <p className="text-xs text-purple-600 font-semibold uppercase">Profit</p>
                        <p className="text-xl font-bold text-purple-900">
                          ₹{(results.find(r => r.teamId === myTeam?.id && r.round === session.currentRound - 1)?.profit! / 10000000).toFixed(1)}Cr
                        </p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-slate-500 italic">No results available for the previous round.</p>
                )}
              </div>
            )}
            <Leaderboard teams={teams} results={results} round={session.currentRound} status={session.status} isAnalysisPhase={session.isAnalysisPhase} />
            <MarketContext round={session.currentRound} />
          </div>
        </div>
      </main>
    </div>
  );
}

function RoundInfoBanner({ round }: { round: number }) {
  const roundInfo = [
    { 
      title: "Strategy Foundation", 
      desc: "Choose a segment you would like to focus upon and positioning you would like to adopt. State your assumptions." 
    },
    { 
      title: "Go-To-Market Strategy", 
      desc: "Choose your product, price, channel, and promotion mix to establish market presence." 
    },
    { 
      title: "Optimization", 
      desc: "Perform one key correction in your strategy to generate more volume and increase penetration." 
    },
    { 
      title: "Policy Shock", 
      desc: "Govt Tax Alert: 25% duty on imported steel. Final prices for imported goods will rise by ~35%." 
    },
    { 
      title: "Market Disruption", 
      desc: "Health Alert: BIS declares 50% of CPVC pipes unhealthy. Major demand shift to Stainless Steel expected." 
    },
  ];

  const current = roundInfo[round - 1];

  return (
    <motion.div 
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-gradient-to-r from-blue-600 to-indigo-700 rounded-2xl p-6 text-white shadow-lg"
    >
      <div className="flex items-start gap-4">
        <div className="bg-white/20 p-3 rounded-xl backdrop-blur-sm">
          <Info className="h-6 w-6" />
        </div>
        <div>
          <h2 className="text-xl font-bold">Round {round}: {current.title}</h2>
          <p className="text-blue-100 mt-1">{current.desc}</p>
        </div>
      </div>
    </motion.div>
  );
}

function DecisionForm({ session, team, decisions }: { session: Session, team: Team, decisions: Decision[] }) {
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState<Partial<Decision>>({
    segmentAllocation: { residential: 40, commercial: 40, government: 20 },
    positioning: INDUSTRY_CONTEXT.positioning[0],
    productStrategy: INDUSTRY_CONTEXT.productStrategy[0],
    pricing: 500,
    distributionChannel: { influencers: 40, dealers: 40, direct: 20 },
    promotionAllocation: { events: 0, socialMedia: 0, tradeMagazines: 0, influencerEvents: 0 },
    sourcing: 'Domestic',
    productionCapacityChoice: 'Medium',
    salesForceStrategy: INDUSTRY_CONTEXT.salesForceOptions[1],
    overallStrategy: 'Premium positioning',
    assumptions: '',
  });

  useEffect(() => {
    // Find the most recent decision for this team
    const latestDecision = decisions
      .filter(d => d.teamId === team.id && d.round < session.currentRound)
      .sort((a, b) => b.round - a.round)[0];

    if (latestDecision) {
      setFormData({
        segmentAllocation: latestDecision.segmentAllocation,
        positioning: latestDecision.positioning,
        productStrategy: latestDecision.productStrategy || INDUSTRY_CONTEXT.productStrategy[0],
        pricing: latestDecision.pricing || 500,
        distributionChannel: latestDecision.distributionChannel || { influencers: 40, dealers: 40, direct: 20 },
        promotionAllocation: latestDecision.promotionAllocation || { events: 0, socialMedia: 0, tradeMagazines: 0, influencerEvents: 0 },
        sourcing: latestDecision.sourcing || 'Domestic',
        productionCapacityChoice: latestDecision.productionCapacityChoice || 'Medium',
        salesForceStrategy: latestDecision.salesForceStrategy || INDUSTRY_CONTEXT.salesForceOptions[1],
        overallStrategy: latestDecision.overallStrategy || 'Premium positioning',
        assumptions: latestDecision.assumptions || '',
      });
    }
  }, [session.currentRound, team.id, decisions]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validation for segment allocation total
    const segTotal = Object.values(formData.segmentAllocation!).reduce((a, b) => (a as number) + (b as number), 0);
    if (segTotal !== 100) {
      alert(`Segment allocation must total 100%. Current total: ${segTotal}%`);
      return;
    }

    // Validation for distribution channel total
    if (session.currentRound >= 2) {
      const distTotal = Object.values(formData.distributionChannel!).reduce((a, b) => (a as number) + (b as number), 0);
      if (distTotal !== 100) {
        alert(`Distribution channel allocation must total 100%. Current total: ${distTotal}%`);
        return;
      }
    }

    setLoading(true);
    try {
      await addDoc(collection(db, 'decisions'), {
        ...formData,
        teamId: team.id,
        sessionId: session.id,
        round: session.currentRound,
        submittedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'decisions');
    } finally {
      setLoading(false);
    }
  };

  const round = session.currentRound;

  return (
    <div className="bg-white rounded-2xl p-8 shadow-sm border border-slate-200">
      <h3 className="text-xl font-bold text-slate-900 mb-6">Submit Decisions (Round {round})</h3>
      <form onSubmit={handleSubmit} className="space-y-8">
        {/* Round 1: Segment + Positioning + Assumptions */}
        {(round >= 1) && (
          <>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="font-semibold text-slate-800 flex items-center gap-2">
                  <PieChart className="h-5 w-5 text-blue-600" />
                  Segment Allocation (%)
                </h4>
                <span className={cn(
                  "text-sm font-bold px-2 py-1 rounded-lg",
                  Object.values(formData.segmentAllocation!).reduce((a, b) => (a as number) + (b as number), 0) === 100 
                    ? "bg-green-100 text-green-700" 
                    : "bg-red-100 text-red-700"
                )}>
                  Total: {Object.values(formData.segmentAllocation!).reduce((a, b) => (a as number) + (b as number), 0)}%
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {Object.keys(formData.segmentAllocation!).map((seg) => (
                  <div key={seg}>
                    <label className="block text-xs font-medium text-slate-500 uppercase mb-1">{seg}</label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={formData.segmentAllocation![seg as keyof typeof formData.segmentAllocation]}
                      onChange={(e) => setFormData({
                        ...formData,
                        segmentAllocation: { ...formData.segmentAllocation!, [seg]: parseInt(e.target.value) }
                      })}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2"
                    />
                  </div>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Positioning</label>
                <select
                  value={formData.positioning}
                  onChange={(e) => setFormData({ ...formData, positioning: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2"
                >
                  {INDUSTRY_CONTEXT.positioning.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              {round === 1 && (
                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium text-slate-700 mb-1">Assumptions</label>
                  <textarea
                    required
                    value={formData.assumptions}
                    onChange={(e) => setFormData({ ...formData, assumptions: e.target.value })}
                    placeholder="State the assumptions you have made for your strategy..."
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 h-24"
                  />
                </div>
              )}
            </div>
          </>
        )}

        {/* Round 2+: Product, Price, Channel, Promotion, Capacity, Sales Force */}
        {round >= 2 && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Product Strategy</label>
                <select
                  value={formData.productStrategy}
                  onChange={(e) => setFormData({ ...formData, productStrategy: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2"
                >
                  {INDUSTRY_CONTEXT.productStrategy.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Sourcing</label>
                <select
                  value={formData.sourcing}
                  onChange={(e) => setFormData({ ...formData, sourcing: e.target.value as 'Domestic' | 'Imported' })}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2"
                >
                  <option value="Domestic">Domestic (Indian Steel)</option>
                  <option value="Imported">Imported (Global Steel)</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Production Capacity</label>
                <select
                  value={formData.productionCapacityChoice}
                  onChange={(e) => setFormData({ ...formData, productionCapacityChoice: e.target.value as 'Small' | 'Medium' | 'Large' })}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2"
                >
                  <option value="Small">Small (50k - 100k units)</option>
                  <option value="Medium">Medium (100k - 200k units)</option>
                  <option value="Large">Large (200k - 350k units)</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Sales Force Strategy</label>
                <select
                  value={formData.salesForceStrategy}
                  onChange={(e) => setFormData({ ...formData, salesForceStrategy: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2"
                >
                  {INDUSTRY_CONTEXT.salesForceOptions.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Pricing (₹ per meter)</label>
                <input
                  type="number"
                  min="300"
                  max="1000"
                  value={formData.pricing}
                  onChange={(e) => setFormData({ ...formData, pricing: parseInt(e.target.value) })}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2"
                />
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="font-semibold text-slate-800">Distribution Channel (%)</h4>
                <span className={cn(
                  "text-sm font-bold px-2 py-1 rounded-lg",
                  Object.values(formData.distributionChannel!).reduce((a, b) => (a as number) + (b as number), 0) === 100 
                    ? "bg-green-100 text-green-700" 
                    : "bg-red-100 text-red-700"
                )}>
                  Total: {Object.values(formData.distributionChannel!).reduce((a, b) => (a as number) + (b as number), 0)}%
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {Object.keys(formData.distributionChannel!).map((chan) => (
                  <div key={chan}>
                    <label className="block text-xs font-medium text-slate-500 uppercase mb-1">{chan}</label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={formData.distributionChannel![chan as keyof typeof formData.distributionChannel]}
                      onChange={(e) => setFormData({
                        ...formData,
                        distributionChannel: { ...formData.distributionChannel!, [chan]: parseInt(e.target.value) }
                      })}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2"
                    />
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-4">
              <h4 className="font-semibold text-slate-800">Promotion Allocation (₹)</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {Object.keys(formData.promotionAllocation!).map((prom) => (
                  <div key={prom}>
                    <label className="block text-xs font-medium text-slate-500 uppercase mb-1">{prom.replace(/([A-Z])/g, ' $1')}</label>
                    <input
                      type="number"
                      min="0"
                      value={formData.promotionAllocation![prom as keyof typeof formData.promotionAllocation]}
                      onChange={(e) => setFormData({
                        ...formData,
                        promotionAllocation: { ...formData.promotionAllocation!, [prom]: parseInt(e.target.value) }
                      })}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2"
                    />
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {round === 3 && (
          <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-amber-600 mt-0.5" />
            <p className="text-sm text-amber-800">
              <strong>Round 3 Strategy Correction:</strong> You are encouraged to make one key correction to your strategy to generate more volume and increase penetration.
            </p>
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-blue-600 text-white py-3 rounded-xl font-bold hover:bg-blue-700 disabled:opacity-50 transition-all shadow-md"
        >
          {loading ? <Loader2 className="h-5 w-5 animate-spin mx-auto" /> : 'Submit Decisions'}
        </button>
      </form>
    </div>
  );
}

function TeamResults({ team, results, round, decisions, isAnalysisPhase }: { team: Team, results: Result[], round: number, decisions: Decision[], isAnalysisPhase: boolean }) {
  const [showHistory, setShowHistory] = useState(false);
  const teamResults = results.filter(r => r.teamId === team.id).sort((a, b) => a.round - b.round);
  const myDecisions = decisions.filter(d => d.teamId === team.id).sort((a, b) => a.round - b.round);
  
  // If we are in analysis phase, show the current round's result. Otherwise show the previous round's result.
  const latestResult = isAnalysisPhase 
    ? teamResults.find(r => r.round === round) 
    : teamResults.find(r => r.round === round - 1);
    
  const displayResult = latestResult || teamResults[teamResults.length - 1];
  const previousResult = displayResult ? teamResults.find(r => r.round === displayResult.round - 1) : null;

  if (!displayResult) {
    return (
      <div className="bg-white rounded-2xl p-8 shadow-sm border border-slate-200 text-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600 mx-auto mb-4" />
        <p className="text-slate-500">Waiting for round results...</p>
      </div>
    );
  }

  if (displayResult.round === 1) {
    return (
      <div className="bg-blue-50 rounded-2xl p-8 shadow-sm border border-blue-200 text-center">
        <Info className="h-8 w-8 text-blue-600 mx-auto mb-4" />
        <h3 className="text-lg font-bold text-blue-900 mb-2">Round 1 Complete</h3>
        <p className="text-blue-700 italic">"Round 1 was the Strategy Foundation phase. There are no financial winners or losers for this round. Real market competition begins from Round 2 onwards."</p>
      </div>
    );
  }

  const getDelta = (current: number, previous: number | undefined) => {
    if (previous === undefined || previous === 0) return null;
    const diff = current - previous;
    const percent = (diff / previous) * 100;
    return {
      val: diff,
      percent: percent.toFixed(1),
      isPositive: diff >= 0
    };
  };

  const msDelta = getDelta(displayResult.marketShare, previousResult?.marketShare);
  const volDelta = getDelta(displayResult.volume, previousResult?.volume);
  const revDelta = getDelta(displayResult.revenue, previousResult?.revenue);
  const profDelta = getDelta(displayResult.profit, previousResult?.profit);

  return (
    <div className="space-y-8">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <KPIBox 
          label="Market Share" 
          value={`${(displayResult.marketShare * 100).toFixed(1)}%`} 
          icon={<PieChart className="h-4 w-4" />} 
          color="text-blue-600"
          delta={msDelta}
        />
        <KPIBox 
          label="Volume" 
          value={`${displayResult.volume.toLocaleString()} units`} 
          icon={<Users className="h-4 w-4" />} 
          color="text-orange-600"
          delta={volDelta}
        />
        <KPIBox 
          label="Revenue" 
          value={`₹${(displayResult.revenue / 10000000).toFixed(2)} Cr`} 
          icon={<TrendingUp className="h-4 w-4" />} 
          color="text-green-600"
          delta={revDelta}
        />
        <KPIBox 
          label="Profit" 
          value={`₹${(displayResult.profit / 10000000).toFixed(2)} Cr`} 
          icon={<DollarSign className="h-4 w-4" />} 
          color="text-indigo-600"
          delta={profDelta}
        />
      </div>

      {/* New Metrics Section */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
          <h4 className="font-bold text-slate-900 mb-4 flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-blue-600" />
            Operational Metrics
          </h4>
          <div className="space-y-4">
            <div className="flex justify-between items-center pb-2 border-b border-slate-50">
              <span className="text-sm text-slate-500">Forecasted Demand</span>
              <span className="font-semibold">{displayResult.forecastedDemand?.toLocaleString()} units</span>
            </div>
            <div className="flex justify-between items-center pb-2 border-b border-slate-50">
              <span className="text-sm text-slate-500">Installed Capacity</span>
              <span className="font-semibold">{displayResult.installedCapacity?.toLocaleString()} units</span>
            </div>
            <div className="flex justify-between items-center pb-2 border-b border-slate-50">
              <span className="text-sm text-slate-500">Capacity Utilization</span>
              <div className="flex items-center gap-2">
                <div className="w-24 h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div 
                    className={cn(
                      "h-full transition-all",
                      displayResult.capacityUtilization > 95 ? "bg-red-500" : 
                      displayResult.capacityUtilization > 70 ? "bg-green-500" : "bg-blue-500"
                    )}
                    style={{ width: `${Math.min(100, displayResult.capacityUtilization)}%` }}
                  />
                </div>
                <span className="font-semibold">{displayResult.capacityUtilization}%</span>
              </div>
            </div>
            <div className="flex justify-between items-center pb-2 border-b border-slate-50">
              <span className="text-sm text-slate-500">Break-even Volume</span>
              <span className="font-semibold">{displayResult.breakEvenVolume?.toLocaleString()} units</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-slate-500">Lost Sales (Capacity)</span>
              <span className={cn("font-semibold", displayResult.lostSales > 0 ? "text-red-600" : "text-slate-900")}>
                {displayResult.lostSales?.toLocaleString()} units
              </span>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
          <h4 className="font-bold text-slate-900 mb-4 flex items-center gap-2">
            <Users className="h-5 w-5 text-indigo-600" />
            Sales Force & Strategy
          </h4>
          <div className="space-y-4">
            <div className="flex justify-between items-center pb-2 border-b border-slate-50">
              <span className="text-sm text-slate-500">Sales Force Efficiency</span>
              <span className="font-bold text-indigo-600">{(displayResult.salesForceEfficiency * 100).toFixed(0)}%</span>
            </div>
            
            <div>
              <p className="text-xs font-bold text-slate-400 uppercase mb-2">Key Strengths</p>
              <div className="flex flex-wrap gap-2">
                {displayResult.strengths?.map((s, i) => (
                  <span key={i} className="px-2 py-1 bg-green-50 text-green-700 text-[10px] font-bold rounded-lg border border-green-100">
                    {s}
                  </span>
                )) || <span className="text-xs italic text-slate-400">None identified</span>}
              </div>
            </div>

            <div>
              <p className="text-xs font-bold text-slate-400 uppercase mb-2">Key Weaknesses</p>
              <div className="flex flex-wrap gap-2">
                {displayResult.weaknesses?.map((w, i) => (
                  <span key={i} className="px-2 py-1 bg-red-50 text-red-700 text-[10px] font-bold rounded-lg border border-red-100">
                    {w}
                  </span>
                )) || <span className="text-xs italic text-slate-400">None identified</span>}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Strategy Explanation */}
      <div className="bg-blue-50 rounded-2xl p-6 border border-blue-100">
        <h4 className="font-bold text-blue-900 mb-2 flex items-center gap-2">
          <Info className="h-5 w-5" />
          Strategy Analysis
        </h4>
        <p className="text-blue-800 text-sm leading-relaxed italic">
          "{displayResult.explanation}"
        </p>
      </div>

      {/* Charts */}
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
        <h4 className="font-bold text-slate-900 mb-6">Performance Trends</h4>
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={teamResults}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="round" label={{ value: 'Round', position: 'insideBottom', offset: -5 }} />
              <YAxis />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="revenue" stroke="#2563eb" name="Revenue" strokeWidth={2} />
              <Line type="monotone" dataKey="profit" stroke="#10b981" name="Profit" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Decision History Toggle */}
      <div className="flex justify-center">
        <button 
          onClick={() => setShowHistory(!showHistory)}
          className="flex items-center gap-2 text-blue-600 font-semibold hover:text-blue-700 transition-colors"
        >
          {showHistory ? 'Hide Decision History' : 'View Decision History'}
          <ChevronRight className={cn("h-4 w-4 transition-transform", showHistory && "rotate-90")} />
        </button>
      </div>

      <AnimatePresence>
        {showHistory && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="space-y-6 overflow-hidden"
          >
            <h4 className="font-bold text-slate-900 flex items-center gap-2">
              <Award className="h-5 w-5 text-blue-600" />
              Decision History
            </h4>
            <div className="grid grid-cols-1 gap-4">
              {myDecisions.map((dec) => (
                <div key={dec.id} className="bg-white rounded-xl p-6 border border-slate-200 shadow-sm">
                  <div className="flex items-center justify-between mb-4">
                    <span className="bg-blue-100 text-blue-700 px-3 py-1 rounded-full text-xs font-bold">Round {dec.round}</span>
                    <span className="text-xs text-slate-400">
                      {dec.submittedAt ? new Date((dec.submittedAt as any).seconds * 1000).toLocaleString() : 'Just now'}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div>
                      <p className="text-slate-500 text-[10px] uppercase font-bold">Pricing</p>
                      <p className="font-semibold">₹{dec.pricing || 'N/A'}</p>
                    </div>
                    <div>
                      <p className="text-slate-500 text-[10px] uppercase font-bold">Sourcing</p>
                      <p className="font-semibold">{dec.sourcing || 'Domestic'}</p>
                    </div>
                    <div>
                      <p className="text-slate-500 text-[10px] uppercase font-bold">Positioning</p>
                      <p className="font-semibold">{dec.positioning}</p>
                    </div>
                    <div>
                      <p className="text-slate-500 text-[10px] uppercase font-bold">Product</p>
                      <p className="font-semibold">{dec.productStrategy || 'N/A'}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function KPIBox({ label, value, icon, color, delta }: { label: string, value: string, icon: React.ReactNode, color: string, delta?: { val: number, percent: string, isPositive: boolean } | null }) {
  return (
    <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-200">
      <div className={cn("flex items-center gap-2 mb-1", color)}>
        {icon}
        <span className="text-xs font-bold uppercase tracking-wider">{label}</span>
      </div>
      <div className="text-xl font-bold text-slate-900">{value}</div>
      {delta && (
        <div className={cn(
          "text-[10px] font-bold mt-1 flex items-center gap-0.5",
          delta.isPositive ? "text-green-600" : "text-red-600"
        )}>
          {delta.isPositive ? '↑' : '↓'} {delta.percent}%
        </div>
      )}
    </div>
  );
}

function Leaderboard({ teams, results, round, status, isAnalysisPhase }: { teams: Team[], results: Result[], round: number, status: string, isAnalysisPhase: boolean }) {
  const displayRound = (status === 'completed' || isAnalysisPhase) ? round : round - 1;
  
  const sortedTeams = teams.map(t => {
    // Calculate cumulative profit up to displayRound
    const teamResults = results.filter(r => r.teamId === t.id && r.round <= displayRound);
    const cumulativeProfit = teamResults.reduce((sum, r) => sum + r.profit, 0);
    const latestResult = teamResults.find(r => r.round === displayRound);
    
    return { ...t, cumulativeProfit, latestResult };
  }).sort((a, b) => b.cumulativeProfit - a.cumulativeProfit);

  if (displayRound <= 0) {
    return (
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
        <h3 className="text-lg font-bold text-slate-900 mb-4 flex items-center gap-2">
          <Trophy className="h-5 w-5 text-amber-500" />
          Leaderboard
        </h3>
        <div className="p-4 bg-blue-50 rounded-xl border border-blue-100 text-center">
          <p className="text-blue-800 font-medium">Simulation Starting</p>
          <p className="text-xs text-blue-600 mt-1">Rankings will appear after Round 1.</p>
        </div>
      </div>
    );
  }

  if (displayRound === 1) {
    return (
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
        <h3 className="text-lg font-bold text-slate-900 mb-4 flex items-center gap-2">
          <Trophy className="h-5 w-5 text-amber-500" />
          Leaderboard
        </h3>
        <div className="p-4 bg-blue-50 rounded-xl border border-blue-100 text-center">
          <p className="text-blue-800 font-medium">Strategy Foundation Phase</p>
          <p className="text-xs text-blue-600 mt-1">No rankings for Round 1. Competition starts in Round 2.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
      <h3 className="text-lg font-bold text-slate-900 mb-4 flex items-center gap-2">
        <Trophy className="h-5 w-5 text-amber-500" />
        Leaderboard
      </h3>
      <div className="space-y-3">
        {sortedTeams.map((team, idx) => (
          <div key={team.id} className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-100">
            <div className="flex items-center gap-3">
              <span className={cn(
                "w-6 h-6 flex items-center justify-center rounded-full text-xs font-bold",
                idx === 0 ? "bg-amber-100 text-amber-700" :
                idx === 1 ? "bg-slate-200 text-slate-700" :
                idx === 2 ? "bg-orange-100 text-orange-700" :
                "bg-slate-100 text-slate-500"
              )}>
                {idx + 1}
              </span>
              <span className="font-semibold text-slate-700">{team.name}</span>
            </div>
            <div className="text-right">
              <div className="text-sm font-bold text-blue-600">
                ₹{(team.cumulativeProfit / 10000000).toFixed(2)} Cr
              </div>
              <div className="text-[10px] text-slate-400 uppercase font-bold">
                Cumulative Profit
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MarketContext({ round }: { round: number }) {
  return (
    <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
      <h3 className="text-lg font-bold text-slate-900 mb-4 flex items-center gap-2">
        <BarChart3 className="h-5 w-5 text-blue-600" />
        Market Context
      </h3>
      <div className="space-y-4 text-sm text-slate-600">
        <div className="p-3 bg-blue-50 rounded-xl border border-blue-100">
          <p className="font-semibold text-blue-800 mb-1">Industry Overview</p>
          <ul className="list-disc list-inside space-y-1">
            <li>CPVC Market Share: 85%</li>
            <li>Iron Pipes: 8%</li>
            <li>Stainless Steel: 7% (Emerging)</li>
          </ul>
        </div>
        <div className="p-3 bg-indigo-50 rounded-xl border border-indigo-100">
          <p className="font-semibold text-indigo-800 mb-1">Growth Trends</p>
          <ul className="list-disc list-inside space-y-1">
            <li>Residential: +27% YoY</li>
            <li>Commercial: +22% YoY</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

function InstructorControls({ session, teams, decisions, results }: { session: Session, teams: Team[], decisions: Decision[], results: Result[] }) {
  const [loading, setLoading] = useState(false);

  const startSimulation = async () => {
    setLoading(true);
    await updateDoc(doc(db, 'sessions', session.id), { 
      status: 'active',
      isAnalysisPhase: false 
    });
    setLoading(false);
  };

  const calculateResults = async () => {
    setLoading(true);
    const currentRoundDecisions = decisions.filter(d => d.round === session.currentRound);
    const previousResults = results.filter(r => r.round === session.currentRound - 1);
    
    // Calculate results
    const newResults = calculateRoundResults(teams, currentRoundDecisions, previousResults, session.currentRound);
    
    // Save results
    const batch = writeBatch(db);
    newResults.forEach(r => {
      const resRef = doc(collection(db, 'results'));
      batch.set(resRef, r);
    });

    // Set analysis phase
    const sessionRef = doc(db, 'sessions', session.id);
    batch.update(sessionRef, { isAnalysisPhase: true });
    
    await batch.commit();
    setLoading(false);
  };

  const startNextRound = async () => {
    setLoading(true);
    const sessionRef = doc(db, 'sessions', session.id);
    if (session.currentRound < 5) {
      await updateDoc(sessionRef, { 
        currentRound: session.currentRound + 1,
        isAnalysisPhase: false 
      });
    } else {
      await updateDoc(sessionRef, { 
        status: 'completed',
        isAnalysisPhase: false 
      });
    }
    setLoading(false);
  };

  const allSubmitted = teams.every(t => decisions.some(d => d.teamId === t.id && d.round === session.currentRound));

  return (
    <div className="flex items-center gap-2">
      {session.status === 'waiting' && (
        <button
          onClick={startSimulation}
          disabled={loading || teams.length === 0}
          className="flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-green-700 disabled:opacity-50"
        >
          <Play className="h-4 w-4" />
          Start Sim
        </button>
      )}
      {session.status === 'active' && !session.isAnalysisPhase && (
        <button
          onClick={calculateResults}
          disabled={loading}
          className={cn(
            "flex items-center gap-2 px-4 py-2 rounded-lg font-semibold transition-all",
            allSubmitted 
              ? "bg-blue-600 text-white hover:bg-blue-700 shadow-md" 
              : "bg-amber-100 text-amber-700 hover:bg-amber-200"
          )}
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <BarChart3 className="h-4 w-4" />}
          {allSubmitted ? 'Calculate Results' : 'Force Calculate'}
        </button>
      )}
      {session.status === 'active' && session.isAnalysisPhase && (
        <button
          onClick={startNextRound}
          disabled={loading}
          className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-indigo-700 shadow-md"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          {session.currentRound < 5 ? `Start Round ${session.currentRound + 1}` : 'Complete Simulation'}
        </button>
      )}
    </div>
  );
}

function CompetitionBenchmark() {
  return (
    <div className="bg-white rounded-2xl p-8 shadow-sm border border-slate-200">
      <div className="flex items-center gap-3 mb-6">
        <div className="bg-blue-100 p-3 rounded-xl">
          <BarChart3 className="h-6 w-6 text-blue-600" />
        </div>
        <div>
          <h3 className="text-xl font-bold text-slate-900">Industry Competition Benchmark</h3>
          <p className="text-sm text-slate-500">Pre-simulation Market Overview</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
          <p className="text-xs font-bold text-slate-400 uppercase mb-1">Total Market Size</p>
          <p className="text-2xl font-bold text-slate-900">1,000,000 units</p>
          <p className="text-xs text-green-600 font-medium mt-1">↑ 15% Annual Growth</p>
        </div>
        <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
          <p className="text-xs font-bold text-slate-400 uppercase mb-1">Typical Pricing</p>
          <p className="text-2xl font-bold text-slate-900">₹450 – ₹750</p>
          <p className="text-xs text-slate-500 font-medium mt-1">Per meter (SS Pipes)</p>
        </div>
        <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
          <p className="text-xs font-bold text-slate-400 uppercase mb-1">SS Penetration</p>
          <p className="text-2xl font-bold text-slate-900">7%</p>
          <p className="text-xs text-blue-600 font-medium mt-1">High potential for CPVC conversion</p>
        </div>
      </div>

      <div className="space-y-6">
        <div>
          <h4 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
            <PieChart className="h-4 w-4 text-blue-600" />
            Market Segment Split
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="p-4 bg-blue-50 rounded-xl border border-blue-100">
              <p className="font-bold text-blue-900">Residential (40%)</p>
              <p className="text-xs text-blue-700 mt-1">High volume, price sensitive, influencer-driven.</p>
            </div>
            <div className="p-4 bg-green-50 rounded-xl border border-green-100">
              <p className="font-bold text-green-900">Commercial (40%)</p>
              <p className="text-xs text-green-700 mt-1">Quality focused, dealer network critical.</p>
            </div>
            <div className="p-4 bg-indigo-50 rounded-xl border border-indigo-100">
              <p className="font-bold text-indigo-900">Government (20%)</p>
              <p className="text-xs text-indigo-700 mt-1">L1 tender based, domestic preference.</p>
            </div>
          </div>
        </div>

        <div>
          <h4 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
            <Users className="h-4 w-4 text-indigo-600" />
            Competitor Archetypes
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="p-4 border border-slate-100 rounded-xl">
              <p className="font-bold text-slate-900">Premium Player</p>
              <p className="text-xs text-slate-500 mt-1">High price, imported steel, focus on commercial/luxury residential.</p>
            </div>
            <div className="p-4 border border-slate-100 rounded-xl">
              <p className="font-bold text-slate-900">Cost Leader</p>
              <p className="text-xs text-slate-500 mt-1">Low price, domestic sourcing, high volume residential focus.</p>
            </div>
            <div className="p-4 border border-slate-100 rounded-xl">
              <p className="font-bold text-slate-900">Govt Specialist</p>
              <p className="text-xs text-slate-500 mt-1">Domestic sourcing, direct sales force, high government allocation.</p>
            </div>
            <div className="p-4 border border-slate-100 rounded-xl">
              <p className="font-bold text-slate-900">Service Differentiator</p>
              <p className="text-xs text-slate-500 mt-1">Product + Service strategy, high satisfaction, premium pricing.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function InstructorOverview({ session, teams, decisions, results }: { session: Session, teams: Team[], decisions: Decision[], results: Result[] }) {
  const [viewRound, setViewRound] = useState(session.currentRound);
  const [activeTab, setActiveTab] = useState<'progress' | 'leaderboard' | 'intelligence'>('progress');
  const currentRoundDecisions = decisions.filter(d => d.round === viewRound);
  const currentRoundResults = results.filter(r => r.round === viewRound);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);

  useEffect(() => {
    setViewRound(session.currentRound);
  }, [session.currentRound]);
  
  const selectedDecision = currentRoundDecisions.find(d => d.teamId === selectedTeamId);
  const selectedResult = currentRoundResults.find(r => r.teamId === selectedTeamId);
  
  const cumulativeResults = teams.map(t => {
    const teamResults = results.filter(r => r.teamId === t.id && r.round <= (session.status === 'completed' ? 5 : session.currentRound - 1));
    const totalProfit = teamResults.reduce((sum, r) => sum + r.profit, 0);
    const totalRevenue = teamResults.reduce((sum, r) => sum + r.revenue, 0);
    const avgMarketShare = teamResults.length > 0 ? teamResults.reduce((sum, r) => sum + r.marketShare, 0) / teamResults.length : 0;
    return { ...t, totalProfit, totalRevenue, avgMarketShare };
  }).sort((a, b) => b.totalProfit - a.totalProfit);

  // Competitive Intelligence Calculations
  const avgPrice = currentRoundDecisions.length > 0 
    ? currentRoundDecisions.reduce((sum, d) => sum + (d.pricing || 0), 0) / currentRoundDecisions.length 
    : 0;
  
  const avgProm = currentRoundDecisions.length > 0
    ? currentRoundDecisions.reduce((sum, d) => {
        const p = d.promotionAllocation;
        return sum + (p.events || 0) + (p.socialMedia || 0) + (p.tradeMagazines || 0) + (p.influencerEvents || 0);
      }, 0) / currentRoundDecisions.length
    : 0;

  const topPerformer = currentRoundResults.length > 0 
    ? teams.find(t => t.id === [...currentRoundResults].sort((a, b) => b.profit - a.profit)[0].teamId)
    : null;

  return (
    <div className="space-y-8">
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-4">
            <h3 className="text-lg font-bold text-slate-900">Instructor Dashboard</h3>
            <div className="flex bg-slate-100 p-1 rounded-lg">
              <button 
                onClick={() => setActiveTab('progress')}
                className={cn("px-3 py-1 rounded-md text-[10px] font-bold transition-all", activeTab === 'progress' ? "bg-white text-blue-600 shadow-sm" : "text-slate-500")}
              >
                Submissions
              </button>
              <button 
                onClick={() => setActiveTab('leaderboard')}
                className={cn("px-3 py-1 rounded-md text-[10px] font-bold transition-all", activeTab === 'leaderboard' ? "bg-white text-blue-600 shadow-sm" : "text-slate-500")}
              >
                Leaderboard
              </button>
              <button 
                onClick={() => setActiveTab('intelligence')}
                className={cn("px-3 py-1 rounded-md text-[10px] font-bold transition-all", activeTab === 'intelligence' ? "bg-white text-blue-600 shadow-sm" : "text-slate-500")}
              >
                Intelligence
              </button>
            </div>
          </div>
          <div className="flex items-center gap-2 bg-slate-100 p-1 rounded-lg">
            {[1, 2, 3, 4, 5].map(r => (
              <button
                key={r}
                onClick={() => setViewRound(r)}
                disabled={r > (session.status === 'completed' ? 5 : session.currentRound)}
                className={cn(
                  "px-3 py-1 rounded-md text-xs font-bold transition-all",
                  viewRound === r ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-700",
                  r > (session.status === 'completed' ? 5 : session.currentRound) && "opacity-30 cursor-not-allowed"
                )}
              >
                R{r}
              </button>
            ))}
          </div>
        </div>

        {activeTab === 'progress' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {teams.map(team => {
              const decision = currentRoundDecisions.find(d => d.teamId === team.id);
              const hasSubmitted = !!decision;
              return (
                <div 
                  key={team.id} 
                  className={cn(
                    "p-4 rounded-xl border flex items-center justify-between cursor-pointer transition-all",
                    hasSubmitted ? "bg-green-50 border-green-200 hover:bg-green-100" : "bg-slate-50 border-slate-200 hover:bg-slate-100",
                    selectedTeamId === team.id && "ring-2 ring-blue-500"
                  )}
                  onClick={() => setSelectedTeamId(team.id)}
                >
                  <span className="font-medium text-slate-700">{team.name}</span>
                  {hasSubmitted ? (
                    <span className="text-xs font-bold text-green-600 uppercase">Submitted</span>
                  ) : (
                    <span className="text-xs font-bold text-slate-400 uppercase">Pending</span>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {activeTab === 'leaderboard' && (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="py-3 px-4 text-xs font-bold text-slate-400 uppercase">Rank</th>
                  <th className="py-3 px-4 text-xs font-bold text-slate-400 uppercase">Team</th>
                  <th className="py-3 px-4 text-xs font-bold text-slate-400 uppercase text-right">Cum. Revenue</th>
                  <th className="py-3 px-4 text-xs font-bold text-slate-400 uppercase text-right">Cum. Profit</th>
                </tr>
              </thead>
              <tbody>
                {cumulativeResults.map((team, idx) => (
                  <tr key={team.id} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                    <td className="py-4 px-4">
                      <span className={cn(
                        "w-6 h-6 flex items-center justify-center rounded-full text-xs font-bold",
                        idx === 0 ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-500"
                      )}>
                        {idx + 1}
                      </span>
                    </td>
                    <td className="py-4 px-4 font-semibold text-slate-700">{team.name}</td>
                    <td className="py-4 px-4 text-right font-mono text-sm">₹{(team.totalRevenue / 10000000).toFixed(2)} Cr</td>
                    <td className="py-4 px-4 text-right font-mono text-sm font-bold text-blue-600">₹{(team.totalProfit / 10000000).toFixed(2)} Cr</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === 'intelligence' && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="p-4 bg-blue-50 rounded-xl border border-blue-100">
              <p className="text-[10px] font-bold text-blue-600 uppercase mb-1">Avg Industry Price</p>
              <p className="text-2xl font-bold text-blue-900">₹{Math.round(avgPrice)}</p>
            </div>
            <div className="p-4 bg-indigo-50 rounded-xl border border-indigo-100">
              <p className="text-[10px] font-bold text-indigo-600 uppercase mb-1">Avg Promotion Spend</p>
              <p className="text-2xl font-bold text-indigo-900">₹{(avgProm / 100000).toFixed(1)}L</p>
            </div>
            <div className="p-4 bg-amber-50 rounded-xl border border-amber-100">
              <p className="text-[10px] font-bold text-amber-600 uppercase mb-1">Top Performer (R{viewRound})</p>
              <p className="text-2xl font-bold text-amber-900">{topPerformer?.name || 'N/A'}</p>
            </div>
          </div>
        )}
      </div>

      {/* Team Decision Detail View */}
      <AnimatePresence>
        {selectedTeamId && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200"
          >
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-bold text-slate-900">
                Performance Analysis: {teams.find(t => t.id === selectedTeamId)?.name} (Round {viewRound})
              </h3>
              <button 
                onClick={() => setSelectedTeamId(null)}
                className="text-slate-400 hover:text-slate-600"
              >
                Close
              </button>
            </div>

            {selectedDecision ? (
              <div className="space-y-8">
                {/* Results Summary if available */}
                {selectedResult && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-4 bg-slate-50 rounded-xl border border-slate-100">
                    <div>
                      <p className="text-[10px] uppercase text-slate-500 font-bold">Revenue</p>
                      <p className="text-sm font-bold">₹{(selectedResult.revenue / 10000000).toFixed(2)} Cr</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase text-slate-500 font-bold">Profit</p>
                      <p className="text-sm font-bold text-blue-600">₹{(selectedResult.profit / 10000000).toFixed(2)} Cr</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase text-slate-500 font-bold">Market Share</p>
                      <p className="text-sm font-bold">{(selectedResult.marketShare * 100).toFixed(1)}%</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase text-slate-500 font-bold">Utilization</p>
                      <p className="text-sm font-bold">{selectedResult.capacityUtilization}%</p>
                    </div>
                  </div>
                )}

                {/* Strategy Explanation */}
                {selectedResult && (
                  <div className="p-4 bg-blue-50 rounded-xl border border-blue-100">
                    <p className="text-xs font-bold text-blue-600 uppercase mb-2">Strategy Explanation</p>
                    <p className="text-sm italic text-blue-800 leading-relaxed">"{selectedResult.explanation}"</p>
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="space-y-4">
                    <h4 className="font-semibold text-slate-800 border-b pb-2">Strategy & Sourcing</h4>
                    <p className="text-sm"><span className="text-slate-500">Positioning:</span> {selectedDecision.positioning}</p>
                    <p className="text-sm"><span className="text-slate-500">Capacity:</span> <span className="font-bold">{selectedDecision.productionCapacityChoice || 'Medium'}</span></p>
                    <p className="text-sm"><span className="text-slate-500">Sales Force:</span> <span className="font-bold">{selectedDecision.salesForceStrategy || 'Standard'}</span></p>
                    <p className="text-sm"><span className="text-slate-500">Sourcing:</span> <span className="font-bold text-blue-600">{selectedDecision.sourcing || 'Domestic'}</span></p>
                    
                    {selectedDecision.assumptions && (
                      <div className="mt-4 p-3 bg-slate-50 rounded-lg">
                        <p className="text-xs font-bold text-slate-500 uppercase mb-1">Assumptions</p>
                        <p className="text-sm italic text-slate-700">"{selectedDecision.assumptions}"</p>
                      </div>
                    )}
                  </div>
                  <div className="space-y-4">
                    <h4 className="font-semibold text-slate-800 border-b pb-2">Market Mix & Segments</h4>
                    <div className="grid grid-cols-2 gap-4 mb-4">
                      <div className="p-2 bg-slate-50 rounded-lg">
                        <p className="text-[10px] uppercase text-slate-500 font-bold">Pricing</p>
                        <p className="text-sm font-bold">₹{selectedDecision.pricing}</p>
                      </div>
                      <div className="p-2 bg-slate-50 rounded-lg">
                        <p className="text-[10px] uppercase text-slate-500 font-bold">Product</p>
                        <p className="text-sm font-bold">{selectedDecision.productStrategy}</p>
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-3 gap-2">
                      <div className="text-center p-2 bg-blue-50 rounded-lg">
                        <p className="text-[10px] uppercase text-blue-600 font-bold">Resi</p>
                        <p className="text-sm font-bold">{selectedDecision.segmentAllocation?.residential || 0}%</p>
                      </div>
                      <div className="text-center p-2 bg-green-50 rounded-lg">
                        <p className="text-[10px] uppercase text-green-600 font-bold">Comm</p>
                        <p className="text-sm font-bold">{selectedDecision.segmentAllocation?.commercial || 0}%</p>
                      </div>
                      <div className="text-center p-2 bg-indigo-50 rounded-lg">
                        <p className="text-[10px] uppercase text-indigo-600 font-bold">Gov</p>
                        <p className="text-sm font-bold">{selectedDecision.segmentAllocation?.government || 0}%</p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 pt-4 border-t">
                  <div className="space-y-4">
                    <h4 className="font-semibold text-slate-800 border-b pb-2">Distribution Channels</h4>
                    <div className="grid grid-cols-3 gap-2">
                      <div className="text-center p-2 bg-slate-50 rounded-lg">
                        <p className="text-[10px] uppercase text-slate-500 font-bold">Influencers</p>
                        <p className="text-sm font-bold">{selectedDecision.distributionChannel?.influencers || 0}%</p>
                      </div>
                      <div className="text-center p-2 bg-slate-50 rounded-lg">
                        <p className="text-[10px] uppercase text-slate-500 font-bold">Dealers</p>
                        <p className="text-sm font-bold">{selectedDecision.distributionChannel?.dealers || 0}%</p>
                      </div>
                      <div className="text-center p-2 bg-slate-50 rounded-lg">
                        <p className="text-[10px] uppercase text-slate-500 font-bold">Direct</p>
                        <p className="text-sm font-bold">{selectedDecision.distributionChannel?.direct || 0}%</p>
                      </div>
                    </div>
                  </div>
                  <div className="space-y-4">
                    <h4 className="font-semibold text-slate-800 border-b pb-2">Promotion Allocation</h4>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="p-2 bg-slate-50 rounded-lg flex justify-between items-center">
                        <span className="text-[10px] uppercase text-slate-500 font-bold">Events</span>
                        <span className="text-xs font-bold">₹{((selectedDecision.promotionAllocation?.events || 0) / 100000).toFixed(1)}L</span>
                      </div>
                      <div className="p-2 bg-slate-50 rounded-lg flex justify-between items-center">
                        <span className="text-[10px] uppercase text-slate-500 font-bold">Social</span>
                        <span className="text-xs font-bold">₹{((selectedDecision.promotionAllocation?.socialMedia || 0) / 100000).toFixed(1)}L</span>
                      </div>
                      <div className="p-2 bg-slate-50 rounded-lg flex justify-between items-center">
                        <span className="text-[10px] uppercase text-slate-500 font-bold">Trade</span>
                        <span className="text-xs font-bold">₹{((selectedDecision.promotionAllocation?.tradeMagazines || 0) / 100000).toFixed(1)}L</span>
                      </div>
                      <div className="p-2 bg-slate-50 rounded-lg flex justify-between items-center">
                        <span className="text-[10px] uppercase text-slate-500 font-bold">Inf. Events</span>
                        <span className="text-xs font-bold">₹{((selectedDecision.promotionAllocation?.influencerEvents || 0) / 100000).toFixed(1)}L</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-center text-slate-500 py-8 italic">No decisions submitted yet for Round {viewRound}.</p>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Global Results Chart */}
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
        <h3 className="text-lg font-bold text-slate-900 mb-6">Market Share Trends (%)</h3>
        <div className="h-80 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={Array.from({ length: (session.status === 'completed' || session.isAnalysisPhase) ? session.currentRound : session.currentRound - 1 }, (_, i) => {
              const round = i + 1;
              const roundResults = results.filter(r => r.round === round);
              const dataPoint: any = { round };
              teams.forEach(t => {
                const res = roundResults.find(r => r.teamId === t.id);
                dataPoint[t.name] = res ? parseFloat((res.marketShare * 100).toFixed(1)) : 0;
              });
              return dataPoint;
            })}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="round" label={{ value: 'Round', position: 'insideBottom', offset: -5 }} />
              <YAxis />
              <Tooltip />
              <Legend />
              {teams.map((team, index) => (
                <Line 
                  key={team.id}
                  type="monotone" 
                  dataKey={team.name} 
                  stroke={['#2563eb', '#10b981', '#6366f1', '#f59e0b', '#ec4899'][index % 5]} 
                  strokeWidth={2}
                  dot={{ r: 4 }}
                  activeDot={{ r: 6 }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
