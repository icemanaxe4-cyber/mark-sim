import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { doc, onSnapshot, collection, query, where, addDoc, serverTimestamp, updateDoc, getDocs, writeBatch } from 'firebase/firestore';
import { db, auth, handleFirestoreError, OperationType } from '../firebase';
import { Session, UserProfile, Team, Decision, Result, INDUSTRY_CONTEXT } from '../types';
import { Loader2, ChevronLeft, Lock, Unlock, Play, BarChart3, Users, AlertCircle, Info, TrendingUp, DollarSign, PieChart, Award, Trophy, ChevronRight, Clock, Eye } from 'lucide-react';
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

      // Check write-mode membership first, then viewer arrays
      const foundMyTeam = teamData.find(t => t.members.includes(user.uid))
        || teamData.find(t => (t.viewers || []).includes(user.uid))
        || null;
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
  // A viewer is in the team's viewers[] array but NOT in members[]
  const isViewer = !isInstructor && myTeam
    ? (myTeam.viewers || []).includes(user.uid) && !myTeam.members.includes(user.uid)
    : false;
  const currentRoundDecisions = decisions.filter(d => d.round === session.currentRound);
  const hasSubmitted = myTeam ? currentRoundDecisions.some(d => d.teamId === myTeam.id && d.submittedAt) : false;

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
              <p className="text-xs text-slate-500">Round {session.currentRound} of 6 • {session.status}</p>
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
            {isViewer && (
              <div className="flex items-center gap-1.5 bg-amber-50 border border-amber-200 text-amber-700 px-3 py-1.5 rounded-lg">
                <Eye className="h-4 w-4" />
                <span className="text-sm font-semibold">View Mode</span>
              </div>
            )}
            <div className="hidden sm:flex items-center gap-2 bg-blue-50 px-3 py-1.5 rounded-lg border border-blue-100">
              <Users className="h-4 w-4 text-blue-600" />
              <span className="text-sm font-semibold text-blue-700">{teams.length} Teams</span>
            </div>
            {!isInstructor && myTeam && results.some(r => r.teamId === myTeam.id) && (
              <div className="flex items-center gap-2 bg-indigo-50 px-3 py-1.5 rounded-lg border border-indigo-100">
                <PieChart className="h-4 w-4 text-indigo-600" />
                <span className="text-sm font-bold text-indigo-700">
                  PDC: {(results.filter(r => r.teamId === myTeam.id).sort((a, b) => b.round - a.round)[0]?.marketShare * 100).toFixed(1)}%
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
            {session.currentRound === 1 && !isInstructor && !hasSubmitted && !session.isAnalysisPhase && !isViewer && (
              <CompetitionBenchmark totalMarketSize={session.totalMarketSize} />
            )}

            {/* Writer mode: show the editable decision form */}
            {!isInstructor && !isViewer && session.status === 'active' && !hasSubmitted && !session.isAnalysisPhase && (
              <DecisionForm session={session} team={myTeam!} decisions={decisions} />
            )}

            {/* Viewer mode: show live read-only mirror of the writer's decisions */}
            {!isInstructor && isViewer && session.status === 'active' && !session.isAnalysisPhase && myTeam && (
              <ViewerDecisionPanel session={session} team={myTeam} decisions={decisions} />
            )}

            {/* Waiting screen: submitted but analysis hasn't started yet */}
            {!isInstructor && !isViewer && hasSubmitted && !session.isAnalysisPhase && session.status !== 'completed' && (
              <div className="bg-white rounded-2xl p-8 shadow-sm border border-slate-200 text-center">
                <Loader2 className="h-8 w-8 animate-spin text-blue-600 mx-auto mb-4" />
                <h3 className="text-lg font-bold text-slate-900 mb-2">Round {session.currentRound} Submitted!</h3>
                <p className="text-slate-500 mb-6">Your strategy has been submitted. Please wait while other teams finish. The instructor will move the competition forward once all teams have submitted.</p>
                <div className="inline-flex items-center gap-2 text-amber-600 bg-amber-50 px-4 py-2 rounded-lg border border-amber-100">
                  <Clock className="h-4 w-4" />
                  <span className="text-sm font-medium">Waiting for instructor...</span>
                </div>
              </div>
            )}

            {!isInstructor && session.status === 'active' && session.isAnalysisPhase && (
              <div className="bg-blue-50 rounded-2xl p-8 shadow-sm border border-blue-200 text-center">
                <Info className="h-8 w-8 text-blue-600 mx-auto mb-4" />
                <h3 className="text-lg font-bold text-blue-900 mb-2">Analysis Phase</h3>
                <p className="text-blue-700">The round has ended. Please review the results below. The instructor will start the next round shortly.</p>
              </div>
            )}

            {/* Show results only during analysis phase or when session is completed */}
            {(!isInstructor && myTeam && (session.isAnalysisPhase || session.status === 'completed')) && (
              <TeamResults
                team={myTeam!}
                teams={teams}
                results={results}
                round={session.currentRound}
                decisions={decisions}
                isAnalysisPhase={session.isAnalysisPhase}
                sessionStatus={session.status}
              />
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
                        <p className="text-xs text-blue-600 font-semibold uppercase">Potential Demand Capture</p>
                        <p className="text-xl font-bold text-blue-900">
                          {(results.find(r => r.teamId === myTeam?.id && r.round === session.currentRound - 1)?.marketShare! * 100).toFixed(1)}%
                        </p>
                      </div>
                      <div className="p-3 bg-green-50 rounded-xl">
                        <p className="text-xs text-green-600 font-semibold uppercase">Volume</p>
                        <p className="text-xl font-bold text-green-900">
                          {results.find(r => r.teamId === myTeam?.id && r.round === session.currentRound - 1)?.volume.toLocaleString()} units
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
      desc: "Health Alert: BIS declares 50% of CPVC pipes unhealthy. Demand shift to SS expected. NOTE: High import duties on steel continue to keep imported goods prices high."
    },
    {
      title: "New Competition",
      desc: "A new domestic entrant has launched with 1 Lakh (100,000 units) capacity, targeting the mass market. Overall SS penetration is now at peak (25%)."
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

// ─── Viewer Decision Panel ──────────────────────────────────────────────────
// Read-only mirror of the writer's live draft, updated in real time via props
function ViewerDecisionPanel({ session, team, decisions }: { session: Session; team: Team; decisions: Decision[] }) {
  const round = session.currentRound;

  // Get the writer's current-round decision (draft or submitted)
  const writerDecision = decisions
    .filter(d => d.teamId === team.id && d.round === round)
    .sort((a, b) => (b as any).updatedAt?.seconds - (a as any).updatedAt?.seconds)[0] || null;

  const isSubmitted = writerDecision?.submittedAt != null;

  const Field = ({ label, value }: { label: string; value: React.ReactNode }) => (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">{label}</span>
      <span className="text-sm font-semibold text-slate-800 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">{value}</span>
    </div>
  );

  return (
    <div className="bg-white rounded-2xl p-8 shadow-sm border-2 border-amber-200">
      {/* Header banner */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="bg-amber-100 p-2 rounded-xl">
            <Eye className="h-5 w-5 text-amber-600" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-900">Viewing Team Decisions — Round {round}</h3>
            <p className="text-xs text-amber-600 font-medium">You are in view-only mode. This panel updates live.</p>
          </div>
        </div>
        <div className={cn(
          "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold border",
          isSubmitted
            ? "bg-green-50 border-green-200 text-green-700"
            : writerDecision
              ? "bg-blue-50 border-blue-200 text-blue-700 animate-pulse"
              : "bg-slate-50 border-slate-200 text-slate-500"
        )}>
          <span className={cn(
            "w-2 h-2 rounded-full",
            isSubmitted ? "bg-green-500" : writerDecision ? "bg-blue-500" : "bg-slate-400"
          )} />
          {isSubmitted ? "Submitted" : writerDecision ? "Draft (live)" : "No draft yet"}
        </div>
      </div>

      {!writerDecision ? (
        <div className="text-center py-10 text-slate-400">
          <Clock className="h-8 w-8 mx-auto mb-3 opacity-40" />
          <p className="text-sm">The writer hasn't started their draft for Round {round} yet.</p>
          <p className="text-xs mt-1">This panel will update automatically when they begin.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Segment Allocation */}
          <div className="space-y-3">
            <h4 className="font-semibold text-slate-700 flex items-center gap-2 text-sm">
              <PieChart className="h-4 w-4 text-blue-500" /> Segment Allocation
            </h4>
            <div className="grid grid-cols-3 gap-3">
              {Object.entries(writerDecision.segmentAllocation || {}).map(([k, v]) => (
                <Field key={k} label={k} value={`${v}%`} />
              ))}
            </div>
          </div>

          {/* Positioning */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Positioning" value={writerDecision.positioning} />
            {round >= 2 && <Field label="Product Strategy" value={writerDecision.productStrategy} />}
            {round >= 2 && <Field label="Sourcing" value={writerDecision.sourcing} />}
            {round >= 2 && <Field label="Production Capacity" value={writerDecision.productionCapacityChoice} />}
            {round >= 2 && <Field label="Pricing (₹/m)" value={`₹${writerDecision.pricing}`} />}
            {round >= 2 && <Field label="Sales Force" value={`${writerDecision.salesForceCount} people @ ₹${((writerDecision.salesForceSalary || 0) / 100000).toFixed(1)}L/yr`} />}
          </div>

          {/* Distribution Channel */}
          {round >= 2 && (
            <div className="space-y-3">
              <h4 className="font-semibold text-slate-700 text-sm">Distribution Channel</h4>
              <div className="grid grid-cols-3 gap-3">
                {Object.entries(writerDecision.distributionChannel || {}).map(([k, v]) => (
                  <Field key={k} label={k} value={`${v}%`} />
                ))}
              </div>
            </div>
          )}

          {/* Promotion Allocation */}
          {round >= 2 && (
            <div className="space-y-3">
              <h4 className="font-semibold text-slate-700 text-sm">Promotion Allocation</h4>
              <div className="grid grid-cols-2 gap-3">
                {Object.entries(writerDecision.promotionAllocation || {}).map(([k, v]) => (
                  <Field key={k} label={k.replace(/([A-Z])/g, ' $1')} value={`₹${((v as number) / 100000).toFixed(0)}L`} />
                ))}
              </div>
            </div>
          )}

          {/* Overall Strategy */}
          <div className="space-y-1">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Overall Strategy</span>
            <div className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 text-sm text-slate-800 whitespace-pre-wrap min-h-[3rem]">
              {writerDecision.overallStrategy || <span className="italic text-slate-400">Not entered yet</span>}
            </div>
          </div>

          {/* Assumptions (Round 1 only) */}
          {round === 1 && (
            <div className="space-y-1">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Assumptions</span>
              <div className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 text-sm text-slate-800 whitespace-pre-wrap min-h-[3rem]">
                {writerDecision.assumptions || <span className="italic text-slate-400">Not entered yet</span>}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
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
    salesForceCount: 10,
    salesForceSalary: 500000,
    overallStrategy: 'Premium positioning',
    assumptions: '',
  });
  const [draftId, setDraftId] = useState<string | null>(null);

  const segTotal = Object.values(formData.segmentAllocation || {}).reduce<number>((a, b) => a + (b as number), 0);
  const distTotal = Object.values(formData.distributionChannel || {}).reduce<number>((a, b) => a + (b as number), 0);
  const promTotal = Object.values(formData.promotionAllocation || {}).reduce<number>((a, b) => a + (b as number), 0);
  const sfTotal = (formData.salesForceCount || 0) * (formData.salesForceSalary || 0);

  // Load existing draft or previous round data
  useEffect(() => {
    const draft = decisions.find(d => d.teamId === team.id && d.round === session.currentRound && !d.submittedAt);

    if (draft) {
      setDraftId(draft.id!);
      setFormData({
        segmentAllocation: draft.segmentAllocation,
        positioning: draft.positioning,
        productStrategy: draft.productStrategy,
        pricing: draft.pricing,
        distributionChannel: draft.distributionChannel,
        promotionAllocation: draft.promotionAllocation,
        sourcing: draft.sourcing,
        productionCapacityChoice: draft.productionCapacityChoice,
        salesForceCount: draft.salesForceCount || 10,
        salesForceSalary: draft.salesForceSalary || 500000,
        overallStrategy: draft.overallStrategy,
        assumptions: draft.assumptions || '',
      });
    } else {
      // If no draft, load previous round data
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
          salesForceCount: latestDecision.salesForceCount || 10,
          salesForceSalary: latestDecision.salesForceSalary || 500000,
          overallStrategy: latestDecision.overallStrategy || 'Premium positioning',
          assumptions: latestDecision.assumptions || '',
        });
      }
    }
  }, [session.currentRound, team.id]); // Load once per round or when draft found

  // Auto-save logic
  useEffect(() => {
    const saveTimeout = setTimeout(async () => {
      // Only auto-save if we are in active phase and haven't submitted yet
      if (session.status !== 'active' || session.isAnalysisPhase) return;

      try {
        if (draftId) {
          const docRef = doc(db, 'decisions', draftId);
          await updateDoc(docRef, {
            ...formData,
            updatedAt: serverTimestamp()
          });
        } else {
          // Create initial draft
          const docRef = await addDoc(collection(db, 'decisions'), {
            ...formData,
            teamId: team.id,
            sessionId: session.id,
            round: session.currentRound,
            submittedAt: null, // It's a draft
            createdAt: serverTimestamp()
          });
          setDraftId(docRef.id);
        }
      } catch (error) {
        console.error("Auto-save failed:", error);
      }
    }, 1500); // Debounce saves

    return () => clearTimeout(saveTimeout);
  }, [formData, session.id, team.id, session.currentRound]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validation for segment allocation total
    if (session.currentRound >= 1) {
      if (segTotal !== 100) {
        alert(`Segment allocation must total 100%. Current total: ${segTotal}%`);
        return;
      }
    }

    if (session.currentRound >= 2) {
      // Validation for distribution channel total
      if (distTotal !== 100) {
        alert(`Distribution channel allocation must total 100%. Current total: ${distTotal}%`);
        return;
      }

      // Validation for promotion budget
      if (promTotal > INDUSTRY_CONTEXT.maxPromotionBudget) {
        alert(`Promotion budget cannot exceed ₹${(INDUSTRY_CONTEXT.maxPromotionBudget / 100000).toFixed(0)}L. Current total: ₹${(promTotal / 100000).toFixed(1)}L`);
        return;
      }

      // Salesforce budget validation
      if (sfTotal > 8000000) {
        alert(`Salesforce budget cannot exceed ₹80L. Current total: ₹${(sfTotal / 100000).toFixed(1)}L`);
        return;
      }
    }

    setLoading(true);
    try {
      if (draftId) {
        await updateDoc(doc(db, 'decisions', draftId), {
          ...formData,
          submittedAt: serverTimestamp(),
        });
      } else {
        await addDoc(collection(db, 'decisions'), {
          ...formData,
          teamId: team.id,
          sessionId: session.id,
          round: session.currentRound,
          submittedAt: serverTimestamp(),
        });
      }
      alert("Decisions submitted successfully!");
    } catch (error) {
      handleFirestoreError(error, draftId ? OperationType.UPDATE : OperationType.CREATE, 'decisions');
    } finally {
      setLoading(false);
    }
  };

  const round = session.currentRound;

  // Capacity is locked when instructor enables it after round 2
  const lockedCapacity = (session.isCapacityLocked && round > 2)
    ? (decisions.find(d => d.teamId === team.id && d.round === 2 && d.submittedAt)?.productionCapacityChoice ?? null)
    : null;

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
                  segTotal === 100
                    ? "bg-green-100 text-green-700"
                    : "bg-red-100 text-red-700"
                )}>
                  Total: {segTotal}%
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
                        segmentAllocation: { ...formData.segmentAllocation!, [seg]: parseInt(e.target.value) || 0 }
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
                {lockedCapacity ? (
                  <div className="flex items-center gap-2 w-full rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm">
                    <Lock className="h-4 w-4 text-amber-600 flex-shrink-0" />
                    <span className="font-semibold text-amber-800">
                      {lockedCapacity === 'Small' ? 'Small (30,000 units)' : lockedCapacity === 'Medium' ? 'Medium (50,000 units)' : 'High (100,000 units)'}
                    </span>
                    <span className="text-xs text-amber-600 ml-auto">Locked by instructor</span>
                  </div>
                ) : (
                  <select
                    value={formData.productionCapacityChoice}
                    onChange={(e) => setFormData({ ...formData, productionCapacityChoice: e.target.value as 'Small' | 'Medium' | 'Large' })}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2"
                  >
                    <option value="Small">Small (30,000 units)</option>
                    <option value="Medium">Medium (50,000 units)</option>
                    <option value="Large">High (100,000 units)</option>
                  </select>
                )}
              </div>
              <div className="space-y-4">
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="block text-sm font-medium text-slate-700">Sales Force Size</label>
                    <span className="text-xs font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded">{formData.salesForceCount} People</span>
                  </div>
                  <input
                    type="range"
                    min="5"
                    max="16"
                    step="1"
                    value={formData.salesForceCount || 5}
                    onChange={(e) => setFormData({ ...formData, salesForceCount: parseInt(e.target.value) })}
                    className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                  />
                  <div className="flex justify-between text-[10px] text-slate-400 font-bold uppercase mt-1">
                    <span>5 (min)</span>
                    <span>16 (max)</span>
                  </div>
                </div>
              </div>
              <div className="space-y-4">
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="block text-sm font-medium text-slate-700">Salary per head (annual)</label>
                    <span className="text-xs font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded">₹{(formData.salesForceSalary! / 100000).toFixed(1)}L</span>
                  </div>
                  <input
                    type="range"
                    min="300000"
                    max="1600000"
                    step="50000"
                    value={formData.salesForceSalary || 500000}
                    onChange={(e) => setFormData({ ...formData, salesForceSalary: parseInt(e.target.value) })}
                    className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                  />
                  <div className="flex justify-between text-[10px] text-slate-400 font-bold uppercase mt-1">
                    <span>3L (Low)</span>
                    <span>16L (High)</span>
                  </div>
                </div>
              </div>
              <div className={cn(
                "sm:col-span-2 p-3 rounded-xl border flex items-center justify-between",
                sfTotal > 8000000 ? "bg-red-50 border-red-200" : "bg-blue-50 border-blue-200"
              )}>
                <div className="flex items-center gap-2">
                  <DollarSign className={cn("h-5 w-5", sfTotal > 8000000 ? "text-red-500" : "text-blue-500")} />
                  <span className="text-sm font-bold text-slate-700">Total Salesforce Budget</span>
                </div>
                <div className="text-right">
                  <span className={cn("text-xl font-bold", sfTotal > 8000000 ? "text-red-600" : "text-blue-600")}>
                    ₹{(sfTotal / 100000).toFixed(1)}L
                  </span>
                  <p className="text-[10px] text-slate-400 font-bold uppercase">Budget Cap: ₹80L</p>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Pricing (₹ per meter)</label>
                <input
                  type="number"
                  min="300"
                  max="1000"
                  value={formData.pricing}
                  onChange={(e) => setFormData({ ...formData, pricing: parseInt(e.target.value) || 0 })}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2"
                />
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="font-semibold text-slate-800">Distribution Channel (%)</h4>
                <span className={cn(
                  "text-sm font-bold px-2 py-1 rounded-lg",
                  distTotal === 100
                    ? "bg-green-100 text-green-700"
                    : "bg-red-100 text-red-700"
                )}>
                  Total: {distTotal}%
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
                        distributionChannel: { ...formData.distributionChannel!, [chan]: parseInt(e.target.value) || 0 }
                      })}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2"
                    />
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-semibold text-slate-800">Promotion Allocation</h4>
                  <p className="text-[10px] text-slate-500 font-medium italic">Enter values in Lakhs of ₹ (e.g., 5 = ₹5,00,000)</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500">Max: ₹{(INDUSTRY_CONTEXT.maxPromotionBudget / 100000).toFixed(0)}L</span>
                  <span className={cn(
                    "text-sm font-bold px-2 py-1 rounded-lg transition-colors",
                    promTotal <= INDUSTRY_CONTEXT.maxPromotionBudget
                      ? "bg-blue-100 text-blue-700"
                      : "bg-red-100 text-red-700"
                  )}>
                    Total: ₹{(promTotal / 100000).toFixed(0)}L
                  </span>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {Object.keys(formData.promotionAllocation!).map((prom) => (
                  <div key={prom}>
                    <label className="block text-xs font-medium text-slate-500 uppercase mb-1">{prom.replace(/([A-Z])/g, ' $1')} (₹L)</label>
                    <div className="relative">
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={(formData.promotionAllocation![prom as keyof typeof formData.promotionAllocation] || 0) / 100000}
                        onChange={(e) => {
                          const val = parseInt(e.target.value, 10) || 0;
                          setFormData({
                            ...formData,
                            promotionAllocation: { ...formData.promotionAllocation!, [prom]: val * 100000 }
                          });
                        }}
                        className="w-full rounded-lg border border-slate-200 pl-3 pr-8 py-2"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs font-bold">L</span>
                    </div>
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

        {round === 4 && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-red-600 mt-0.5" />
            <p className="text-sm text-red-800">
              <strong>Govt Tax Alert:</strong> 25% duty on imported steel has been implemented. Prices for imported goods will surge.
            </p>
          </div>
        )}

        {round === 5 && (
          <div className="p-4 bg-purple-50 border border-purple-200 rounded-xl space-y-3">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-purple-600 mt-0.5" />
              <p className="text-sm text-purple-800">
                <strong>Market Disruption:</strong> BIS declares 50% of CPVC pipes unhealthy. Shift to Stainless Steel expected.
              </p>
            </div>
            <div className="flex items-start gap-3 border-t border-purple-100 pt-2">
              <AlertCircle className="h-5 w-5 text-red-600 mt-0.5" />
              <p className="text-sm text-red-800 italic">
                Note: Import duties on steel remain extremely high.
              </p>
            </div>
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

function TeamResults({ team, teams, results, round, decisions, isAnalysisPhase, sessionStatus }: { team: Team, teams: Team[], results: Result[], round: number, decisions: Decision[], isAnalysisPhase: boolean, sessionStatus: string }) {
  const [showHistory, setShowHistory] = useState(false);
  const [showIndustryDecisions, setShowIndustryDecisions] = useState(false);
  const teamResults = results.filter(r => r.teamId === team.id).sort((a, b) => a.round - b.round);
  const myDecisions = decisions.filter(d => d.teamId === team.id && d.submittedAt).sort((a, b) => a.round - b.round);

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
        <h3 className="text-lg font-bold text-slate-900 mb-2">Round {round} Submitted!</h3>
        <p className="text-slate-500 mb-6">Please wait while other teams submit their decisions. Once all teams are ready, the instructor will advance the game to reveal the results.</p>
        <div className="flex items-center justify-center gap-2 text-amber-600 bg-amber-50 px-4 py-2 rounded-lg border border-amber-100 inline-flex">
          <Clock className="h-4 w-4" />
          <span className="text-sm font-medium">Waiting for instructor...</span>
        </div>
      </div>
    );
  }

  if (displayResult.round === 1 && isAnalysisPhase) {
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
      {!isAnalysisPhase && sessionStatus === 'active' && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 flex flex-col sm:flex-row items-center gap-4 shadow-sm animate-pulse">
          <div className="bg-amber-100 p-3 rounded-full">
            <Clock className="h-6 w-6 text-amber-600" />
          </div>
          <div className="text-center sm:text-left flex-1">
            <h4 className="font-bold text-amber-900">Decisions Locked for Round {round}</h4>
            <p className="text-sm text-amber-800">
              Your strategy has been submitted. Please wait while other teams finish. The instructor will move the competition forward once all teams have submitted.
            </p>
          </div>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <KPIBox
          label="Potential Demand Capture"
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

      {/* P&L Statement */}
      <PLStatement result={displayResult} decision={myDecisions.find(d => d.round === displayResult.round)} />

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

      {/* FINAL TRANSPARENCY: Round 6 Analysis Phase or Completed Status */}
      {((round === 6 && isAnalysisPhase) || sessionStatus === 'completed') && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-gradient-to-br from-indigo-900 to-slate-900 rounded-3xl p-8 text-white shadow-2xl border border-indigo-500/30"
        >
          <div className="flex items-center gap-3 mb-8">
            <div className="bg-white/20 p-3 rounded-2xl backdrop-blur-md">
              <Trophy className="h-8 w-8 text-amber-400" />
            </div>
            <div>
              <h3 className="text-2xl font-black tracking-tight">Final Market Disclosure</h3>
              <p className="text-indigo-200 font-medium">Complete Financial Transparency of All Competitors</p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left min-w-[800px]">
              <thead>
                <tr className="border-b border-white/10 text-[10px] font-black uppercase tracking-widest text-white/50">
                  <th className="py-4 px-2">Team Name</th>
                  <th className="py-4 px-2">Revenue</th>
                  <th className="py-4 px-2">Variable costs</th>
                  <th className="py-4 px-2">Gross Margin</th>
                  <th className="py-4 px-2">Marketing</th>
                  <th className="py-4 px-2">Sales Force</th>
                  <th className="py-4 px-2">Fixed Costs</th>
                  <th className="py-4 px-2">Net Profit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {teams.map(t => {
                  const teamResults = results.filter(r => r.teamId === t.id && r.round <= 6);
                  const totalProfit = teamResults.reduce((sum, r) => sum + (r.profit || 0), 0);
                  const totalRevenue = teamResults.reduce((sum, r) => sum + (r.revenue || 0), 0);
                  const totalFixed = teamResults.reduce((sum, r) => sum + (r.fixedCosts || 0), 0);
                  const totalSF = teamResults.reduce((sum, r) => sum + (r.salesForceCosts || 0), 0);
                  const totalProm = teamResults.reduce((sum, r) => sum + (r.promotionCosts || 0), 0);
                  const totalVar = teamResults.reduce((sum, r) => sum + (r.variableCosts || 0), 0);
                  const totalContribution = teamResults.reduce((sum, r) => sum + (r.contributionMargin || 0), 0);

                  return { t, totalProfit, totalRevenue, totalFixed, totalSF, totalProm, totalVar, totalContribution };
                })
                  .sort((a, b) => b.totalProfit - a.totalProfit)
                  .map(({ t, totalProfit, totalRevenue, totalFixed, totalSF, totalProm, totalVar, totalContribution }, idx) => (
                    <tr key={t.id} className={cn("group transition-colors", t.id === team.id && "bg-white/5")}>
                      <td className="py-4 px-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-white/40 font-bold w-4">#{idx + 1}</span>
                          <div>
                            <p className="font-bold text-sm leading-tight">{t.name}</p>
                            {t.id === team.id && <p className="text-[9px] text-indigo-300 uppercase tracking-tighter">Current Team</p>}
                          </div>
                        </div>
                      </td>
                      <td className="py-4 px-2 text-indigo-100/70 text-xs font-mono">₹{(totalRevenue / 10000000).toFixed(2)} Cr</td>
                      <td className="py-4 px-2 text-red-300/50 text-xs font-mono">-₹{(totalVar / 10000000).toFixed(2)} Cr</td>
                      <td className="py-4 px-2 text-indigo-300 font-bold text-xs font-mono">₹{(totalContribution / 10000000).toFixed(2)} Cr</td>
                      <td className="py-4 px-2 text-red-200/40 text-[10px] font-mono">₹{(totalProm / 100000).toFixed(1)} L</td>
                      <td className="py-4 px-2 text-red-200/40 text-[10px] font-mono">₹{(totalSF / 100000).toFixed(1)} L</td>
                      <td className="py-4 px-2 text-red-200/40 text-[10px] font-mono">₹{(totalFixed / 100000).toFixed(1)} L</td>
                      <td className={cn("py-4 px-2 font-black font-mono text-sm", totalProfit >= 0 ? "text-green-400" : "text-red-400")}>
                        ₹{(totalProfit / 10000000).toFixed(2)} Cr
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>

          <div className="mt-8 pt-6 border-t border-white/10 flex flex-col sm:flex-row justify-between items-center gap-4">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white/50">
              <Info className="h-4 w-4" />
              Based on all 6 simulation rounds
            </div>
            <button
              onClick={() => window.print()}
              className="bg-white text-slate-900 px-6 py-2 rounded-xl font-bold hover:bg-indigo-50 transition-all flex items-center gap-2"
            >
              Print Final Report
            </button>
          </div>
        </motion.div>
      )}

      {/* Decision History Toggle */}
      <div className="flex flex-col sm:flex-row justify-center gap-4">
        <button
          onClick={() => setShowHistory(!showHistory)}
          className="flex items-center justify-center gap-2 text-blue-600 font-semibold hover:text-blue-700 transition-colors bg-white px-4 py-2 rounded-xl border border-slate-200 shadow-sm"
        >
          {showHistory ? 'Hide My History' : 'My Decision History'}
          <ChevronRight className={cn("h-4 w-4 transition-transform", showHistory && "rotate-90")} />
        </button>

        <button
          onClick={() => setShowIndustryDecisions(!showIndustryDecisions)}
          className="flex items-center justify-center gap-2 text-indigo-600 font-semibold hover:text-indigo-700 transition-colors bg-white px-4 py-2 rounded-xl border border-slate-200 shadow-sm"
        >
          {showIndustryDecisions ? 'Hide Market Decisions' : 'View Industry Decisions'}
          <ChevronRight className={cn("h-4 w-4 transition-transform", showIndustryDecisions && "rotate-90")} />
        </button>
      </div>

      <AnimatePresence>
        {showHistory && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="space-y-6 overflow-hidden mb-8"
          >
            <h4 className="font-bold text-slate-900 flex items-center gap-2">
              <Award className="h-5 w-5 text-blue-600" />
              My Decision History
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
                      <p className="text-slate-500 text-[10px] uppercase font-bold">Sales Force</p>
                      <p className="font-semibold">{dec.salesForceCount} / ₹{(dec.salesForceSalary / 100000).toFixed(1)}L</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}

        {showIndustryDecisions && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="space-y-6 overflow-hidden bg-slate-50 p-6 rounded-2xl border border-slate-200"
          >
            <div className="flex items-center justify-between">
              <h4 className="font-bold text-slate-900 flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-indigo-600" />
                Industry Decisions (Past Rounds)
              </h4>
              <div className="text-[10px] bg-indigo-100 text-indigo-700 font-bold px-2 py-1 rounded">
                MARKET TRANSPARENCY
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-100">
                    <th className="py-2 px-4 text-[10px] font-bold text-slate-400 uppercase">Round</th>
                    <th className="py-2 px-4 text-[10px] font-bold text-slate-400 uppercase">Team</th>
                    <th className="py-2 px-4 text-[10px] font-bold text-slate-400 uppercase">Pricing</th>
                    <th className="py-2 px-4 text-[10px] font-bold text-slate-400 uppercase">Positioning</th>
                    <th className="py-2 px-4 text-[10px] font-bold text-slate-400 uppercase">Sourcing</th>
                    <th className="py-2 px-4 text-[10px] font-bold text-slate-400 uppercase">Sales Force</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {/* Show decisions only for completed rounds or previous rounds */}
                  {[1, 2, 3, 4, 5, 6]
                    .filter(r => r < round || (r === round && isAnalysisPhase) || sessionStatus === 'completed')
                    .reverse()
                    .map(r => (
                      <React.Fragment key={`round-${r}`}>
                        {teams.map(t => {
                          const dec = decisions.find(d => d.teamId === t.id && d.round === r && d.submittedAt);
                          if (!dec) return null;
                          return (
                            <tr key={dec.id} className={cn("text-xs", t.id === team.id ? "bg-blue-50/50" : "")}>
                              <td className="py-3 px-4 font-bold text-slate-400">R{r}</td>
                              <td className="py-3 px-4 font-bold text-slate-700">
                                {t.name} {t.id === team.id && <span className="ml-1 text-[10px] text-blue-500 font-normal underline">(You)</span>}
                              </td>
                              <td className="py-3 px-4 font-medium">₹{dec.pricing || 'N/A'}</td>
                              <td className="py-3 px-4">{dec.positioning}</td>
                              <td className="py-3 px-4">{dec.sourcing || 'Domestic'}</td>
                              <td className="py-3 px-4 text-slate-500">{dec.salesForceCount} / ₹{(dec.salesForceSalary / 100000).toFixed(1)}L</td>
                            </tr>
                          );
                        })}
                      </React.Fragment>
                    ))
                  }
                </tbody>
              </table>
              {![1, 2, 3, 4, 5].some(r => r < round || (r === round && isAnalysisPhase)) && (
                <div className="text-center py-8 text-slate-400 italic text-sm">
                  Transparency will be available after Round 1 results are revealed.
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function PLStatement({ result, decision }: { result: Result, decision?: Decision }) {
  const {
    revenue,
    variableCosts,
    contributionMargin,
    fixedCosts,
    salesForceCosts,
    promotionCosts,
    profit,
    unitPrice,
    unitCost,
    volume
  } = result;

  return (
    <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
      <div className="flex items-center justify-between mb-6">
        <h4 className="font-bold text-slate-900 flex items-center gap-2">
          <DollarSign className="h-5 w-5 text-green-600" />
          Profit & Loss Statement
        </h4>
        <div className="text-[10px] bg-slate-100 px-2 py-1 rounded font-bold text-slate-500 uppercase">
          Round {result.round} Summary
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8 border-b border-slate-100 pb-6">
        <div className="space-y-1">
          <p className="text-[10px] font-bold text-slate-400 uppercase">Unit Economics</p>
          <div className="flex justify-between items-center text-sm">
            <span className="text-slate-600">Avg. Selling Price</span>
            <span className="font-bold">₹{unitPrice}</span>
          </div>
          <div className="flex justify-between items-center text-sm">
            <span className="text-slate-600">Unit Variable Cost</span>
            <span className="font-bold text-red-500">₹{unitCost}</span>
          </div>
          <div className="flex justify-between items-center text-sm border-t border-slate-50 pt-1">
            <span className="text-slate-900 font-semibold">Margin per Unit</span>
            <span className="font-bold text-green-600">₹{(unitPrice - unitCost).toFixed(2)}</span>
          </div>
        </div>
        <div className="space-y-1">
          <p className="text-[10px] font-bold text-slate-400 uppercase">Production</p>
          <div className="flex justify-between items-center text-sm">
            <span className="text-slate-600">Volume Sold</span>
            <span className="font-bold">{volume.toLocaleString()} units</span>
          </div>
          <div className="flex justify-between items-center text-sm">
            <span className="text-slate-600">Capacity Utilization</span>
            <span className="font-bold">{result.capacityUtilization}%</span>
          </div>
        </div>
        <div className="space-y-1">
          <p className="text-[10px] font-bold text-slate-400 uppercase">Efficiency</p>
          <div className="flex justify-between items-center text-sm">
            <span className="text-slate-600">Contribution Margin</span>
            <span className="font-bold text-green-600">{revenue > 0 ? ((contributionMargin / revenue) * 100).toFixed(1) : 0}%</span>
          </div>
          <div className="flex justify-between items-center text-sm">
            <span className="text-slate-600">Net Profit Margin</span>
            <span className="font-bold text-indigo-600">{revenue > 0 ? ((profit / revenue) * 100).toFixed(1) : 0}%</span>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        {/* Revenue Section */}
        <div className="flex justify-between items-center text-base font-bold text-slate-900">
          <span>Gross Sales Revenue</span>
          <span>₹{revenue.toLocaleString()}</span>
        </div>

        {/* Variable costs */}
        <div className="space-y-2">
          <div className="flex justify-between items-center text-sm text-red-600 font-medium">
            <span className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-red-400"></span>
              Variable Costs of Production
            </span>
            <span>- ₹{variableCosts.toLocaleString()}</span>
          </div>
          <div className="pl-6 text-[11px] text-slate-500 space-y-1 italic">
            <p>• Materials, Direct Labor & Energy</p>
            <p>• Inventory Handling & Logistics</p>
          </div>
        </div>

        {/* Contribution */}
        <div className="flex justify-between items-center py-2 bg-slate-50 px-3 rounded-lg text-sm font-bold border border-slate-100">
          <span className="text-slate-700 uppercase tracking-wider text-xs">Total Contribution</span>
          <span className={contributionMargin >= 0 ? "text-green-600" : "text-red-600"}>
            ₹{contributionMargin.toLocaleString()}
          </span>
        </div>

        {/* Fixed costs items */}
        <div className="space-y-3 pt-2">
          <div className="flex justify-between items-center text-sm text-slate-600 font-medium">
            <span className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-slate-300"></span>
              Fixed Operational Overheads
            </span>
            <span>- ₹{fixedCosts.toLocaleString()}</span>
          </div>

          <div className="flex justify-between items-center text-sm text-slate-600 font-medium">
            <span className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-slate-300"></span>
              Sales Force Expenditure
            </span>
            <span>- ₹{salesForceCosts.toLocaleString()}</span>
          </div>

          <div className="space-y-1">
            <div className="flex justify-between items-center text-sm text-slate-600 font-medium">
              <span className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-slate-300"></span>
                Marketing & Promotion
              </span>
              <span>- ₹{promotionCosts.toLocaleString()}</span>
            </div>
            {decision && (
              <div className="pl-6 grid grid-cols-2 gap-x-4 gap-y-1 text-[10px] text-slate-400 font-medium">
                {decision.promotionAllocation.events > 0 && <div>Events: ₹{decision.promotionAllocation.events.toLocaleString()}</div>}
                {decision.promotionAllocation.socialMedia > 0 && <div>Social: ₹{decision.promotionAllocation.socialMedia.toLocaleString()}</div>}
                {decision.promotionAllocation.tradeMagazines > 0 && <div>Trade: ₹{decision.promotionAllocation.tradeMagazines.toLocaleString()}</div>}
                {decision.promotionAllocation.influencerEvents > 0 && <div>Influencers: ₹{decision.promotionAllocation.influencerEvents.toLocaleString()}</div>}
              </div>
            )}
          </div>
        </div>

        {/* Bottom Line */}
        <div className="mt-6 p-5 bg-slate-900 rounded-2xl flex flex-col gap-1 items-center shadow-lg border border-slate-800">
          <span className="text-white/50 font-bold uppercase tracking-widest text-[10px]">Net Operating Profit/Loss</span>
          <span className={cn("text-3xl font-black font-mono tracking-tighter", profit >= 0 ? "text-green-400" : "text-red-400")}>
            {profit < 0 && "-"} ₹{Math.abs(profit).toLocaleString()}
          </span>
          <div className="h-1 w-full bg-slate-800 rounded-full mt-2 overflow-hidden">
            <div
              className={cn("h-full", profit >= 0 ? "bg-green-500" : "bg-red-500")}
              style={{ width: `${Math.min(100, (Math.abs(profit) / Math.max(1, revenue)) * 100)}%` }}
            />
          </div>
        </div>
      </div>
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
        {round >= 4 && (
          <div className="p-3 bg-red-50 rounded-xl border border-red-100 flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-red-600 mt-0.5" />
            <div>
              <p className="font-bold text-red-800 text-xs uppercase">Policy Impact</p>
              <p className="text-red-700 text-xs">Customs duty on raw steel imports is active (25%).</p>
            </div>
          </div>
        )}
        {round === 5 && (
          <div className="p-3 bg-purple-50 rounded-xl border border-purple-100 flex items-start gap-2">
            <TrendingUp className="h-4 w-4 text-purple-600 mt-0.5" />
            <div>
              <p className="font-bold text-purple-800 text-xs uppercase">Industry Shift</p>
              <p className="text-purple-700 text-xs">Major shift from CPVC to Stainless Steel observed.</p>
            </div>
          </div>
        )}
        <div className="p-3 bg-blue-50 rounded-xl border border-blue-100">
          <p className="font-semibold text-blue-800 mb-1">Industry Overview</p>
          <ul className="list-disc list-inside space-y-1">
            <li>CPVC Market Share: {round === 5 ? '~35%' : '85%'}</li>
            <li>Iron Pipes: 8%</li>
            <li>Stainless Steel: {round === 5 ? '20%+' : '7%'}</li>
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

  const toggleCapacityLock = async () => {
    setLoading(true);
    await updateDoc(doc(db, 'sessions', session.id), {
      isCapacityLocked: !session.isCapacityLocked
    });
    setLoading(false);
  };

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
    const currentRoundDecisions = decisions.filter(d => d.round === session.currentRound && d.submittedAt);
    const previousResults = results.filter(r => r.round === session.currentRound - 1);

    // Calculate results
    const newResults = calculateRoundResults(
      teams,
      currentRoundDecisions,
      previousResults,
      session.currentRound,
      session.totalMarketSize
    );

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
    if (session.currentRound < 6) {
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

  const allSubmitted = teams.every(t => decisions.some(d => d.teamId === t.id && d.round === session.currentRound && d.submittedAt));

  return (
    <div className="flex items-center gap-2">
      {/* Capacity lock toggle — visible from round 2 onwards */}
      {session.currentRound >= 2 && (
        <button
          onClick={toggleCapacityLock}
          disabled={loading}
          title={session.isCapacityLocked ? 'Unlock production capacity (allow students to change)' : 'Lock production capacity to round 2 choices'}
          className={cn(
            "flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all border",
            session.isCapacityLocked
              ? "bg-amber-100 text-amber-700 border-amber-200 hover:bg-amber-200"
              : "bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200"
          )}
        >
          {session.isCapacityLocked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
          {session.isCapacityLocked ? 'Capacity Locked' : 'Lock Capacity'}
        </button>
      )}
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

function CompetitionBenchmark({ totalMarketSize }: { totalMarketSize?: number }) {
  const displayMarketSize = totalMarketSize || 6000000;
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
          <p className="text-2xl font-bold text-slate-900">{displayMarketSize.toLocaleString()} units</p>
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
    // Include current round when in analysis phase (results just calculated) — mirrors chart logic
    const maxRound = session.status === 'completed' ? 6
      : session.isAnalysisPhase ? session.currentRound
        : session.currentRound - 1;
    const teamResults = results.filter(r => r.teamId === t.id && r.round <= maxRound);
    const totalProfit = teamResults.reduce((sum, r) => sum + r.profit, 0);
    const totalRevenue = teamResults.reduce((sum, r) => sum + r.revenue, 0);
    const avgMarketShare = teamResults.length > 0 ? teamResults.reduce((sum, r) => sum + r.marketShare, 0) / teamResults.length : 0;
    // Actual market share: look up the exact value for the viewed round (not an average)
    const viewRoundResult = results.find(r => r.teamId === t.id && r.round === viewRound);
    const viewRoundActualMS = viewRoundResult?.actualMarketShare ?? null;
    return { ...t, totalProfit, totalRevenue, avgMarketShare, viewRoundActualMS };
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
            {[1, 2, 3, 4, 5, 6].map(r => (
              <button
                key={r}
                onClick={() => setViewRound(r)}
                disabled={r > (session.status === 'completed' ? 6 : session.currentRound)}
                className={cn(
                  "px-3 py-1 rounded-md text-xs font-bold transition-all",
                  viewRound === r ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-700",
                  r > (session.status === 'completed' ? 6 : session.currentRound) && "opacity-30 cursor-not-allowed"
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
              const decision = currentRoundDecisions.find(d => d.teamId === team.id && d.submittedAt);
              const draft = currentRoundDecisions.find(d => d.teamId === team.id && !d.submittedAt);
              const hasSubmitted = !!decision;
              const hasDraft = !!draft;
              return (
                <div
                  key={team.id}
                  className={cn(
                    "p-4 rounded-xl border flex items-center justify-between cursor-pointer transition-all",
                    hasSubmitted ? "bg-green-50 border-green-200 hover:bg-green-100" :
                      hasDraft ? "bg-amber-50 border-amber-200 hover:bg-amber-100" :
                        "bg-slate-50 border-slate-200 hover:bg-slate-100",
                    selectedTeamId === team.id && "ring-2 ring-blue-500"
                  )}
                  onClick={() => setSelectedTeamId(team.id)}
                >
                  <div>
                    <p className="font-bold text-slate-700 text-sm">{team.name}</p>
                    <p className="text-[10px] text-slate-500 uppercase font-bold">
                      {hasSubmitted ? 'Submitted' : hasDraft ? 'Draft Saved' : 'Waiting'}
                    </p>
                  </div>
                  <div className={cn(
                    "w-2 h-2 rounded-full",
                    hasSubmitted ? "bg-green-500" : hasDraft ? "bg-amber-500" : "bg-slate-300"
                  )} />
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
                  <th className="py-3 px-4 text-xs font-bold text-slate-400 uppercase text-right">Avg PDC</th>
                  <th className="py-3 px-4 text-xs font-bold text-emerald-600 uppercase text-right">Actual MS (R{viewRound})</th>
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
                    <td className="py-4 px-4 text-right font-mono text-sm text-slate-500">{(team.avgMarketShare * 100).toFixed(1)}%</td>
                    <td className="py-4 px-4 text-right font-mono text-sm font-bold text-emerald-600">
                      {team.viewRoundActualMS != null
                        ? `${(team.viewRoundActualMS * 100).toFixed(2)}%`
                        : 'N/A'}
                    </td>
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
              <p className="text-2xl font-bold text-blue-900">{viewRound >= 2 ? `₹${Math.round(avgPrice)}` : 'N/A'}</p>
            </div>
            <div className="p-4 bg-indigo-50 rounded-xl border border-indigo-100">
              <p className="text-[10px] font-bold text-indigo-600 uppercase mb-1">Avg Promotion Spend</p>
              <p className="text-2xl font-bold text-indigo-900">{viewRound >= 2 ? `₹${(avgProm / 100000).toFixed(1)}L` : 'N/A'}</p>
            </div>
            <div className="p-4 bg-amber-50 rounded-xl border border-amber-100">
              <p className="text-[10px] font-bold text-amber-600 uppercase mb-1">Top Performer (R{viewRound})</p>
              <p className="text-2xl font-bold text-amber-900">{viewRound >= 2 ? (topPerformer?.name || 'N/A') : 'N/A'}</p>
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
                {selectedResult && viewRound >= 2 && (
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 p-4 bg-slate-50 rounded-xl border border-slate-100">
                    <div>
                      <p className="text-[10px] uppercase text-slate-500 font-bold">Revenue</p>
                      <p className="text-sm font-bold">₹{(selectedResult.revenue / 10000000).toFixed(2)} Cr</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase text-slate-500 font-bold">Profit</p>
                      <p className="text-sm font-bold text-blue-600">₹{(selectedResult.profit / 10000000).toFixed(2)} Cr</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase text-slate-500 font-bold">Potential Demand Capture</p>
                      <p className="text-sm font-bold">{(selectedResult.marketShare * 100).toFixed(1)}%</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase text-slate-500 font-bold">Actual Mkt Share</p>
                      <p className="text-sm font-bold text-emerald-600">
                        {selectedResult.actualMarketShare != null
                          ? `${(selectedResult.actualMarketShare * 100).toFixed(2)}%`
                          : 'N/A'}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase text-slate-500 font-bold">Utilization</p>
                      <p className="text-sm font-bold">{selectedResult.capacityUtilization}%</p>
                    </div>
                  </div>
                )}

                {/* Strategy Explanation */}
                {selectedResult && viewRound >= 2 && (
                  <div className="p-4 bg-blue-50 rounded-xl border border-blue-100">
                    <p className="text-xs font-bold text-blue-600 uppercase mb-2">Strategy Explanation</p>
                    <p className="text-sm italic text-blue-800 leading-relaxed">"{selectedResult.explanation}"</p>
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="space-y-4">
                    <h4 className="font-semibold text-slate-800 border-b pb-2">Strategy & Sourcing</h4>
                    <p className="text-sm"><span className="text-slate-500">Positioning:</span> {selectedDecision.positioning || '-'}</p>
                    <p className="text-sm"><span className="text-slate-500">Capacity:</span> <span className="font-bold">{viewRound >= 2 ? (selectedDecision.productionCapacityChoice || 'Medium') : '-'}</span></p>
                    <p className="text-sm"><span className="text-slate-500">Sales Force:</span> <span className="font-bold">{viewRound >= 2 ? `${selectedDecision.salesForceCount} / ₹${(selectedDecision.salesForceSalary / 100000).toFixed(1)}L` : '-'}</span></p>
                    <p className="text-sm"><span className="text-slate-500">Sourcing:</span> <span className="font-bold text-blue-600">{viewRound >= 2 ? (selectedDecision.sourcing || 'Domestic') : '-'}</span></p>

                    {selectedDecision.assumptions && viewRound === 1 && (
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
                        <p className="text-sm font-bold">{viewRound >= 2 ? (selectedDecision.pricing ? `₹${selectedDecision.pricing}` : '-') : '-'}</p>
                      </div>
                      <div className="p-2 bg-slate-50 rounded-lg">
                        <p className="text-[10px] uppercase text-slate-500 font-bold">Product</p>
                        <p className="text-sm font-bold">{viewRound >= 2 ? (selectedDecision.productStrategy || '-') : '-'}</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      <div className="text-center p-2 bg-blue-50 rounded-lg">
                        <p className="text-[10px] uppercase text-blue-600 font-bold">Resi</p>
                        <p className="text-sm font-bold">{selectedDecision.segmentAllocation?.residential ?? 0}%</p>
                      </div>
                      <div className="text-center p-2 bg-green-50 rounded-lg">
                        <p className="text-[10px] uppercase text-green-600 font-bold">Comm</p>
                        <p className="text-sm font-bold">{selectedDecision.segmentAllocation?.commercial ?? 0}%</p>
                      </div>
                      <div className="text-center p-2 bg-indigo-50 rounded-lg">
                        <p className="text-[10px] uppercase text-indigo-600 font-bold">Gov</p>
                        <p className="text-sm font-bold">{selectedDecision.segmentAllocation?.government ?? 0}%</p>
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
                        <p className="text-sm font-bold">{viewRound >= 2 ? `${selectedDecision.distributionChannel?.influencers ?? 0}%` : '-'}</p>
                      </div>
                      <div className="text-center p-2 bg-slate-50 rounded-lg">
                        <p className="text-[10px] uppercase text-slate-500 font-bold">Dealers</p>
                        <p className="text-sm font-bold">{viewRound >= 2 ? `${selectedDecision.distributionChannel?.dealers ?? 0}%` : '-'}</p>
                      </div>
                      <div className="text-center p-2 bg-slate-50 rounded-lg">
                        <p className="text-[10px] uppercase text-slate-500 font-bold">Direct</p>
                        <p className="text-sm font-bold">{viewRound >= 2 ? `${selectedDecision.distributionChannel?.direct ?? 0}%` : '-'}</p>
                      </div>
                    </div>
                  </div>
                  <div className="space-y-4">
                    <h4 className="font-semibold text-slate-800 border-b pb-2">Promotion Allocation</h4>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="p-2 bg-slate-50 rounded-lg flex justify-between items-center">
                        <span className="text-[10px] uppercase text-slate-500 font-bold">Events</span>
                        <span className="text-xs font-bold">{viewRound >= 2 ? `₹${((selectedDecision.promotionAllocation?.events || 0) / 100000).toFixed(1)}L` : '-'}</span>
                      </div>
                      <div className="p-2 bg-slate-50 rounded-lg flex justify-between items-center">
                        <span className="text-[10px] uppercase text-slate-500 font-bold">Social</span>
                        <span className="text-xs font-bold">{viewRound >= 2 ? `₹${((selectedDecision.promotionAllocation?.socialMedia || 0) / 100000).toFixed(1)}L` : '-'}</span>
                      </div>
                      <div className="p-2 bg-slate-50 rounded-lg flex justify-between items-center">
                        <span className="text-[10px] uppercase text-slate-500 font-bold">Trade</span>
                        <span className="text-xs font-bold">{viewRound >= 2 ? `₹${((selectedDecision.promotionAllocation?.tradeMagazines || 0) / 100000).toFixed(1)}L` : '-'}</span>
                      </div>
                      <div className="p-2 bg-slate-50 rounded-lg flex justify-between items-center">
                        <span className="text-[10px] uppercase text-slate-500 font-bold">Inf. Events</span>
                        <span className="text-xs font-bold">{viewRound >= 2 ? `₹${((selectedDecision.promotionAllocation?.influencerEvents || 0) / 100000).toFixed(1)}L` : '-'}</span>
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
        <h3 className="text-lg font-bold text-slate-900 mb-6">Potential Demand Capture Trends (%)</h3>
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
