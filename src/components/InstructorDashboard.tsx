import React, { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot, addDoc, serverTimestamp, doc, updateDoc, getDocs, writeBatch } from 'firebase/firestore';
import { db, auth, handleFirestoreError, OperationType } from '../firebase';
import { Session, UserProfile, Team, Decision, Result } from '../types';
import { Plus, Play, Lock, Unlock, BarChart3, Users, Settings, LogOut, ChevronRight, Loader2, Trophy, Trash2 } from 'lucide-react';
import { calculateRoundResults } from '../services/simulationEngine';
import { cn } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import { deleteDoc } from 'firebase/firestore';

export default function InstructorDashboard({ user }: { user: UserProfile }) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [newSessionName, setNewSessionName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [isDeleting, setIsDeleting] = useState<string | null>(null);
  const [sessionToDelete, setSessionToDelete] = useState<Session | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const q = query(collection(db, 'sessions'), where('instructorId', '==', user.uid));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const sessionData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Session));
      setSessions(sessionData.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)));
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'sessions');
    });

    return () => unsubscribe();
  }, [user.uid]);

  const createSession = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSessionName.trim()) return;

    setIsCreating(true);
    try {
      const joinCode = Math.random().toString(36).substring(2, 8).toUpperCase();
      await addDoc(collection(db, 'sessions'), {
        name: newSessionName,
        instructorId: user.uid,
        joinCode,
        currentRound: 1,
        status: 'waiting',
        isAnalysisPhase: false,
        createdAt: serverTimestamp(),
        isLocked: false,
      });
      setNewSessionName('');
    } catch (error) {
      console.error('Error creating session:', error);
    } finally {
      setIsCreating(false);
    }
  };

  const deleteSession = async (sessionId: string) => {
    setIsDeleting(sessionId);
    try {
      const batch = writeBatch(db);

      // 1. Delete teams
      const teamsQ = query(collection(db, 'teams'), where('sessionId', '==', sessionId));
      const teamsSnap = await getDocs(teamsQ);
      teamsSnap.forEach(doc => batch.delete(doc.ref));

      // 2. Delete decisions
      const decisionsQ = query(collection(db, 'decisions'), where('sessionId', '==', sessionId));
      const decisionsSnap = await getDocs(decisionsQ);
      decisionsSnap.forEach(doc => batch.delete(doc.ref));

      // 3. Delete results
      const resultsQ = query(collection(db, 'results'), where('sessionId', '==', sessionId));
      const resultsSnap = await getDocs(resultsQ);
      resultsSnap.forEach(doc => batch.delete(doc.ref));

      // 4. Delete session itself
      batch.delete(doc(db, 'sessions', sessionId));

      await batch.commit();
      setSessionToDelete(null);
    } catch (error) {
      console.error('Error deleting session:', error);
    } finally {
      setIsDeleting(null);
    }
  };

  const handleLogout = () => {
    auth.signOut();
    navigate('/login');
  };

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-blue-600 p-1.5 rounded-lg">
              <BarChart3 className="h-6 w-6 text-white" />
            </div>
            <h1 className="text-xl font-bold text-slate-900">MarketSim Instructor</h1>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right hidden sm:block">
              <p className="text-sm font-medium text-slate-900">{user.displayName}</p>
              <p className="text-xs text-slate-500">Instructor Account</p>
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
          {/* Create Session Section */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
              <h2 className="text-lg font-semibold text-slate-900 mb-4">Create New Session</h2>
              <form onSubmit={createSession} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Session Name</label>
                  <input
                    type="text"
                    required
                    value={newSessionName}
                    onChange={(e) => setNewSessionName(e.target.value)}
                    placeholder="e.g., Marketing Fall 2024"
                    className="w-full rounded-lg border border-slate-200 px-4 py-2 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <button
                  type="submit"
                  disabled={isCreating}
                  className="w-full flex items-center justify-center gap-2 bg-blue-600 text-white px-4 py-2.5 rounded-lg font-semibold hover:bg-blue-700 disabled:opacity-50 transition-all"
                >
                  {isCreating ? <Loader2 className="h-5 w-5 animate-spin" /> : <Plus className="h-5 w-5" />}
                  Create Session
                </button>
              </form>
            </div>
          </div>

          {/* Sessions List Section */}
          <div className="lg:col-span-2">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold text-slate-900">Active Sessions</h2>
              <span className="bg-slate-200 text-slate-700 px-2.5 py-0.5 rounded-full text-xs font-medium">
                {sessions.length} Sessions
              </span>
            </div>

            <div className="space-y-4">
              <AnimatePresence mode="popLayout">
                {sessions.map((session) => (
                  <motion.div
                    key={session.id}
                    layout
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200 hover:border-blue-300 transition-all cursor-pointer group"
                    onClick={() => navigate(`/session/${session.id}`)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="space-y-1">
                        <h3 className="text-lg font-bold text-slate-900 group-hover:text-blue-600 transition-colors">
                          {session.name}
                        </h3>
                        <div className="flex items-center gap-4 text-sm text-slate-500">
                          <span className="flex items-center gap-1">
                            <Users className="h-4 w-4" />
                            Join Code: <span className="font-mono font-bold text-blue-600">{session.joinCode}</span>
                          </span>
                          <span className="flex items-center gap-1">
                            <Settings className="h-4 w-4" />
                            Round: {session.currentRound}/5
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className={cn(
                          "px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider",
                          session.status === 'active' ? "bg-green-100 text-green-700" :
                          session.status === 'completed' ? "bg-slate-100 text-slate-700" :
                          "bg-blue-100 text-blue-700"
                        )}>
                          {session.status}
                        </span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSessionToDelete(session);
                          }}
                          disabled={isDeleting === session.id}
                          className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                          title="Delete Session"
                        >
                          {isDeleting === session.id ? (
                            <Loader2 className="h-5 w-5 animate-spin" />
                          ) : (
                            <Trash2 className="h-5 w-5" />
                          )}
                        </button>
                        <ChevronRight className="h-5 w-5 text-slate-400 group-hover:text-blue-500 transition-all" />
                      </div>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>

              {sessions.length === 0 && (
                <div className="text-center py-12 bg-white rounded-2xl border border-dashed border-slate-300">
                  <div className="bg-slate-50 w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4">
                    <BarChart3 className="h-6 w-6 text-slate-400" />
                  </div>
                  <p className="text-slate-500">No sessions created yet. Start by creating one!</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {sessionToDelete && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-2xl p-8 max-w-md w-full shadow-xl border border-slate-200"
            >
              <div className="bg-red-50 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6">
                <Trash2 className="h-8 w-8 text-red-600" />
              </div>
              <h3 className="text-xl font-bold text-slate-900 text-center mb-2">Delete Session?</h3>
              <p className="text-slate-600 text-center mb-8">
                Are you sure you want to delete <span className="font-bold text-slate-900">"{sessionToDelete.name}"</span>? 
                This will permanently remove all teams, decisions, and results. This action cannot be undone.
              </p>
              <div className="flex gap-4">
                <button
                  onClick={() => setSessionToDelete(null)}
                  className="flex-1 px-4 py-2.5 rounded-xl font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={() => deleteSession(sessionToDelete.id)}
                  disabled={isDeleting === sessionToDelete.id}
                  className="flex-1 px-4 py-2.5 rounded-xl font-semibold text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 transition-all shadow-md"
                >
                  {isDeleting === sessionToDelete.id ? (
                    <Loader2 className="h-5 w-5 animate-spin mx-auto" />
                  ) : (
                    'Delete'
                  )}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
