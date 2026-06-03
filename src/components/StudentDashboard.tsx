import React, { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot, getDocs, doc, getDoc, updateDoc, arrayUnion } from 'firebase/firestore';
import { db, auth, handleFirestoreError, OperationType } from '../firebase';
import { Session, UserProfile, Team } from '../types';
import { Plus, LogOut, Loader2, Search, Users, BarChart3, ChevronRight, Eye, PenLine } from 'lucide-react';
import { cn } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { useNavigate } from 'react-router-dom';

export default function StudentDashboard({ user }: { user: UserProfile }) {
  const [joinCode, setJoinCode] = useState('');
  const [availableTeams, setAvailableTeams] = useState<Team[]>([]);
  const [selectedSession, setSelectedSession] = useState<Session | null>(null);
  const [selectedTeamId, setSelectedTeamId] = useState('');
  const [teamsLoading, setTeamsLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [myTeams, setMyTeams] = useState<(Team & { sessionName: string; isViewer: boolean })[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    const memberQuery = query(collection(db, 'teams'), where('members', 'array-contains', user.uid));
    const viewerQuery = query(collection(db, 'teams'), where('viewers', 'array-contains', user.uid));

    const processSnapshot = async (memberDocs: any[], viewerDocs: any[]) => {
      try {
        const allDocs = [
          ...memberDocs.map(d => ({ doc: d, isViewer: false })),
          ...viewerDocs.map(d => ({ doc: d, isViewer: true })),
        ];

        const seen = new Set<string>();
        const unique = allDocs.filter(({ doc }) => {
          if (seen.has(doc.id)) return false;
          seen.add(doc.id);
          return true;
        });

        const teamData = await Promise.all(unique.map(async ({ doc: teamDoc, isViewer }) => {
          const data = teamDoc.data() as Team;
          const sessionDoc = await getDoc(doc(db, 'sessions', data.sessionId));
          return {
            id: teamDoc.id,
            ...data,
            sessionName: sessionDoc.exists() ? sessionDoc.data().name : 'Unknown Session',
            isViewer,
          };
        }));

        setMyTeams(teamData.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)));
      } catch (err) {
        handleFirestoreError(err, OperationType.GET, 'teams');
      }
    };

    let memberDocs: any[] = [];
    let viewerDocs: any[] = [];
    let memberReady = false;
    let viewerReady = false;

    const unsubMember = onSnapshot(memberQuery, (snapshot) => {
      memberDocs = snapshot.docs;
      memberReady = true;
      if (viewerReady) processSnapshot(memberDocs, viewerDocs);
    }, (error) => handleFirestoreError(error, OperationType.GET, 'teams'));

    const unsubViewer = onSnapshot(viewerQuery, (snapshot) => {
      viewerDocs = snapshot.docs;
      viewerReady = true;
      if (memberReady) processSnapshot(memberDocs, viewerDocs);
    }, (error) => handleFirestoreError(error, OperationType.GET, 'teams'));

    return () => {
      unsubMember();
      unsubViewer();
    };
  }, [user.uid]);

  useEffect(() => {
    const code = joinCode.trim().toUpperCase();
    setSelectedTeamId('');
    setAvailableTeams([]);
    setSelectedSession(null);

    if (code.length < 6) {
      setError('');
      return;
    }

    let cancelled = false;
    const loadTeams = async () => {
      setTeamsLoading(true);
      setError('');
      try {
        const sessionQuery = query(collection(db, 'sessions'), where('joinCode', '==', code));
        const sessionSnapshot = await getDocs(sessionQuery);

        if (cancelled) return;
        if (sessionSnapshot.empty) {
          setError('Invalid join code. Please check with your instructor.');
          return;
        }

        const sessionDoc = sessionSnapshot.docs[0];
        const sessionData = { id: sessionDoc.id, ...sessionDoc.data() } as Session;
        const teamsQuery = query(collection(db, 'teams'), where('sessionId', '==', sessionDoc.id));
        const teamsSnapshot = await getDocs(teamsQuery);

        if (cancelled) return;
        const teams = teamsSnapshot.docs
          .map(teamDoc => ({ id: teamDoc.id, ...teamDoc.data() } as Team))
          .sort((a, b) => {
            const aNum = Number(a.name.match(/\d+/)?.[0] || 0);
            const bNum = Number(b.name.match(/\d+/)?.[0] || 0);
            return aNum - bNum || a.name.localeCompare(b.name);
          });

        setSelectedSession(sessionData);
        setAvailableTeams(teams);
        setSelectedTeamId(teams[0]?.id || '');
      } catch (err: any) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setTeamsLoading(false);
      }
    };

    loadTeams();
    return () => {
      cancelled = true;
    };
  }, [joinCode]);

  const handleJoinSession = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!joinCode.trim() || !selectedTeamId) return;

    setLoading(true);
    setError('');

    try {
      const sessionQuery = query(collection(db, 'sessions'), where('joinCode', '==', joinCode.toUpperCase()));
      const sessionSnapshot = await getDocs(sessionQuery);

      if (sessionSnapshot.empty) {
        setError('Invalid join code. Please check with your instructor.');
        setLoading(false);
        return;
      }

      const sessionDoc = sessionSnapshot.docs[0];
      const sessionId = sessionDoc.id;
      const sessionStatus = sessionDoc.data().status as Session['status'];

      const memberQuery = query(
        collection(db, 'teams'),
        where('sessionId', '==', sessionId),
        where('members', 'array-contains', user.uid)
      );
      const memberSnapshot = await getDocs(memberQuery);
      if (!memberSnapshot.empty) {
        setError('You are already in a team for this session.');
        setLoading(false);
        return;
      }

      const viewerQuery = query(
        collection(db, 'teams'),
        where('sessionId', '==', sessionId),
        where('viewers', 'array-contains', user.uid)
      );
      const viewerSnapshot = await getDocs(viewerQuery);
      if (!viewerSnapshot.empty) {
        setError('You are already watching a team in this session.');
        setLoading(false);
        return;
      }

      const selectedTeamDoc = await getDoc(doc(db, 'teams', selectedTeamId));
      if (!selectedTeamDoc.exists() || selectedTeamDoc.data().sessionId !== sessionId) {
        setError('Please select a valid team for this session.');
        setLoading(false);
        return;
      }

      const selectedTeam = selectedTeamDoc.data() as Team;
      const joinsAsWriter = sessionStatus === 'waiting' && (selectedTeam.members || []).length === 0;

      await updateDoc(doc(db, 'teams', selectedTeamId), joinsAsWriter ? {
        members: arrayUnion(user.uid),
      } : {
        viewers: arrayUnion(user.uid),
      });

      setJoinCode('');
      setSelectedTeamId('');
      setSelectedSession(null);
      setAvailableTeams([]);
      navigate(`/session/${sessionId}`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    auth.signOut();
    navigate('/login');
  };

  const selectedTeam = availableTeams.find(team => team.id === selectedTeamId);
  const willJoinAsWriter = !!selectedSession && selectedSession.status === 'waiting' && selectedTeam && (selectedTeam.members || []).length === 0;
  const canJoin = !!selectedTeamId && !teamsLoading && !loading;

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-blue-600 p-1.5 rounded-lg">
              <BarChart3 className="h-6 w-6 text-white" />
            </div>
            <h1 className="text-xl font-bold text-slate-900">MarketSim Student</h1>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right hidden sm:block">
              <p className="text-sm font-medium text-slate-900">{user.displayName}</p>
              <p className="text-xs text-slate-500">Student Account</p>
            </div>
            <button
              onClick={handleLogout}
              className="p-2 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
            >
              <LogOut className="h-5 w-5" />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-1">
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
              <h2 className="text-lg font-semibold text-slate-900 mb-4">Join a Simulation</h2>
              <form onSubmit={handleJoinSession} className="space-y-4">
                {error && (
                  <div className="rounded-md bg-red-50 p-3 text-sm text-red-600 border border-red-100">
                    {error}
                  </div>
                )}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Join Code</label>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      required
                      value={joinCode}
                      onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                      placeholder="Enter 6-digit code"
                      className="w-full rounded-lg border border-slate-200 pl-10 pr-4 py-2 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono uppercase"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Team</label>
                  <div className="relative">
                    <Users className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <select
                      required
                      value={selectedTeamId}
                      onChange={(e) => setSelectedTeamId(e.target.value)}
                      disabled={!selectedSession || teamsLoading || availableTeams.length === 0}
                      className="w-full rounded-lg border border-slate-200 pl-10 pr-4 py-2 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-slate-50 disabled:text-slate-400"
                    >
                      <option value="">{teamsLoading ? 'Loading teams...' : 'Select team'}</option>
                      {availableTeams.map(team => {
                        const hasWriter = (team.members || []).length > 0;
                        const mode = selectedSession?.status === 'waiting' && !hasWriter ? 'Write' : 'View';
                        return (
                          <option key={team.id} value={team.id}>
                            {team.name} - {mode} Mode
                          </option>
                        );
                      })}
                    </select>
                  </div>
                </div>
                {selectedSession && selectedTeam && (
                  <div className={cn(
                    "rounded-lg border px-3 py-2 text-xs font-semibold",
                    willJoinAsWriter
                      ? "bg-green-50 border-green-200 text-green-700"
                      : "bg-amber-50 border-amber-200 text-amber-700"
                  )}>
                    {willJoinAsWriter
                      ? 'You will join this team in write mode.'
                      : 'You will join this team in view-only mode.'}
                  </div>
                )}
                <button
                  type="submit"
                  disabled={!canJoin}
                  className="w-full flex items-center justify-center gap-2 bg-blue-600 text-white px-4 py-2.5 rounded-lg font-semibold hover:bg-blue-700 disabled:opacity-50 transition-all"
                >
                  {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Plus className="h-5 w-5" />}
                  Join Simulation
                </button>
              </form>
            </div>
          </div>

          <div className="lg:col-span-2">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold text-slate-900">My Active Simulations</h2>
              <span className="bg-slate-200 text-slate-700 px-2.5 py-0.5 rounded-full text-xs font-medium">
                {myTeams.length} Active
              </span>
            </div>

            <div className="space-y-4">
              <AnimatePresence mode="popLayout">
                {myTeams.map((team) => (
                  <motion.div
                    key={team.id}
                    layout
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className={cn(
                      "bg-white rounded-2xl p-6 shadow-sm border transition-all cursor-pointer group",
                      team.isViewer
                        ? "border-amber-200 hover:border-amber-400"
                        : "border-slate-200 hover:border-blue-300"
                    )}
                    onClick={() => navigate(`/session/${team.sessionId}`)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="space-y-1">
                        <h3 className="text-lg font-bold text-slate-900 group-hover:text-blue-600 transition-colors">
                          {team.sessionName}
                        </h3>
                        <div className="flex items-center gap-4 text-sm text-slate-500">
                          <span className="flex items-center gap-1">
                            <Users className="h-4 w-4" />
                            Team: <span className="font-semibold text-blue-600">{team.name}</span>
                          </span>
                          {team.isViewer ? (
                            <span className="flex items-center gap-1 text-xs font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                              <Eye className="h-3 w-3" /> View Mode
                            </span>
                          ) : (
                            <span className="flex items-center gap-1 text-xs font-bold text-green-700 bg-green-50 border border-green-200 px-2 py-0.5 rounded-full">
                              <PenLine className="h-3 w-3" /> Write Mode
                            </span>
                          )}
                        </div>
                      </div>
                      <ChevronRight className="h-5 w-5 text-slate-400 group-hover:text-blue-500 transition-all" />
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>

              {myTeams.length === 0 && (
                <div className="text-center py-12 bg-white rounded-2xl border border-dashed border-slate-300">
                  <div className="bg-slate-50 w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Search className="h-6 w-6 text-slate-400" />
                  </div>
                  <p className="text-slate-500">You haven't joined any simulations yet. Enter a join code to start!</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
