import React, { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot, addDoc, serverTimestamp, getDocs, doc, getDoc } from 'firebase/firestore';
import { db, auth, handleFirestoreError, OperationType } from '../firebase';
import { Session, UserProfile, Team } from '../types';
import { Plus, LogOut, Loader2, Search, Users, BarChart3, ChevronRight } from 'lucide-react';
import { cn } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { useNavigate } from 'react-router-dom';

export default function StudentDashboard({ user }: { user: UserProfile }) {
  const [joinCode, setJoinCode] = useState('');
  const [teamName, setTeamName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [myTeams, setMyTeams] = useState<(Team & { sessionName: string })[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    // Find all teams where this user is a member
    const q = query(collection(db, 'teams'), where('members', 'array-contains', user.uid));
    const unsubscribe = onSnapshot(q, async (snapshot) => {
      try {
        const teamData = await Promise.all(snapshot.docs.map(async (teamDoc) => {
          const data = teamDoc.data() as Team;
          const sessionDoc = await getDoc(doc(db, 'sessions', data.sessionId));
          return { 
            id: teamDoc.id, 
            ...data, 
            sessionName: sessionDoc.exists() ? sessionDoc.data().name : 'Unknown Session' 
          };
        }));
        setMyTeams(teamData.sort((a, b) => b.createdAt?.seconds - a.createdAt?.seconds));
      } catch (err) {
        handleFirestoreError(err, OperationType.GET, 'teams');
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'teams');
    });

    return () => unsubscribe();
  }, [user.uid]);

  const handleJoinSession = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!joinCode.trim() || !teamName.trim()) return;

    setLoading(true);
    setError('');

    try {
      // 1. Find session by join code
      const q = query(collection(db, 'sessions'), where('joinCode', '==', joinCode.toUpperCase()));
      const sessionSnapshot = await getDocs(q);

      if (sessionSnapshot.empty) {
        setError('Invalid join code. Please check with your instructor.');
        setLoading(false);
        return;
      }

      const sessionDoc = sessionSnapshot.docs[0];
      const sessionId = sessionDoc.id;

      // 2. Check if user is already in a team for this session
      const teamQuery = query(
        collection(db, 'teams'), 
        where('sessionId', '==', sessionId),
        where('members', 'array-contains', user.uid)
      );
      const teamSnapshot = await getDocs(teamQuery);

      if (!teamSnapshot.empty) {
        setError('You are already in a team for this session.');
        setLoading(false);
        return;
      }

      // 3. Create new team
      await addDoc(collection(db, 'teams'), {
        name: teamName,
        sessionId,
        members: [user.uid],
        createdAt: serverTimestamp(),
      });

      setJoinCode('');
      setTeamName('');
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

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
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
          {/* Join Session Section */}
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
                  <label className="block text-sm font-medium text-slate-700 mb-1">Team Name</label>
                  <div className="relative">
                    <Users className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      required
                      value={teamName}
                      onChange={(e) => setTeamName(e.target.value)}
                      placeholder="e.g., Steel Titans"
                      className="w-full rounded-lg border border-slate-200 pl-10 pr-4 py-2 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full flex items-center justify-center gap-2 bg-blue-600 text-white px-4 py-2.5 rounded-lg font-semibold hover:bg-blue-700 disabled:opacity-50 transition-all"
                >
                  {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Plus className="h-5 w-5" />}
                  Join & Create Team
                </button>
              </form>
            </div>
          </div>

          {/* My Simulations Section */}
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
                    className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200 hover:border-blue-300 transition-all cursor-pointer group"
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
