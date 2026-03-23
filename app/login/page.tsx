'use client';

import { useState } from 'react';
import { motion } from 'motion/react';
import { Mail, Lock, Sparkles, ArrowRight, Github } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { signInWithPopup, signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth';
import { auth, googleProvider } from '@/lib/firebase';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isHoveringCreate, setIsHoveringCreate] = useState(false);
  const router = useRouter();

  const handleGoogleLogin = async () => {
    try {
      setError('');
      await signInWithPopup(auth, googleProvider);
      router.push('/');
    } catch (err: any) {
      setError(err.message || 'Failed to login with Google.');
    }
  };

  const handleEmailAuth = async (isSignup: boolean) => {
    try {
      setError('');
      if (isSignup) {
        await createUserWithEmailAndPassword(auth, email, password);
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
      router.push('/');
    } catch (err: any) {
      setError(err.message || 'Authentication failed.');
    }
  };

  return (
    <div className="min-h-screen bg-[#FAF7F2] flex flex-col items-center justify-center p-4 md:p-8 relative overflow-hidden font-sans text-stone-800 selection:bg-orange-200">
      {/* Soft background gradients - same as main page */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full bg-rose-200/40 blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[60%] h-[60%] rounded-full bg-orange-200/40 blur-[150px]" />
      </div>

      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="w-full max-w-[440px] z-10"
      >
        <div className="flex flex-col items-center mb-10">
          <Link href="/" className="flex items-center gap-3 group">
            <div className="w-12 h-12 rounded-full bg-gradient-to-tr from-rose-400 to-orange-400 shadow-lg shadow-orange-500/20 flex items-center justify-center group-hover:scale-110 transition-transform">
              <Sparkles className="w-6 h-6 text-white" />
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-stone-800">Aura</h1>
          </Link>
          <p className="text-stone-500 mt-4 font-medium">Welcome back, friend.</p>
        </div>

        <div className="bg-white/70 backdrop-blur-2xl p-8 rounded-[2.5rem] border border-white shadow-2xl shadow-stone-200/60 transition-all duration-500">
          
          {/* Social Logins */}
          <div className="space-y-3 mb-6">
            <button 
              onClick={handleGoogleLogin}
              className="w-full flex items-center justify-center gap-3 py-3.5 px-4 bg-white border border-stone-200 rounded-2xl font-semibold text-stone-700 hover:bg-stone-50 hover:border-stone-300 transition-all duration-200 shadow-sm active:scale-[0.98]"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                />
              </svg>
              <span>Continue with Google</span>
            </button>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-600 rounded-xl text-sm font-medium text-center">
              {error}
            </div>
          )}

          <div className="relative mb-8">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-stone-200"></div>
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-[#FAF7F2]/50 backdrop-blur-sm px-4 text-stone-400 font-bold tracking-widest">or</span>
            </div>
          </div>

          {/* Email/Password Form */}
          <form className="space-y-5" onSubmit={(e) => e.preventDefault()}>
            <div className="space-y-2">
              <label className="text-xs font-bold text-stone-400 uppercase tracking-widest ml-1">Email Address</label>
              <div className="relative group">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-stone-400 group-focus-within:text-orange-400 transition-colors" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@example.com"
                  className="w-full bg-white border border-stone-200 rounded-2xl py-4 pl-12 pr-4 outline-none focus:ring-2 focus:ring-orange-200 focus:border-orange-400 transition-all text-stone-800 font-medium placeholder:text-stone-300 shadow-sm"
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex justify-between items-center ml-1">
                <label className="text-xs font-bold text-stone-400 uppercase tracking-widest">Password</label>
                <button className="text-[10px] font-bold text-rose-400 hover:text-rose-500 uppercase tracking-widest">Forgot?</button>
              </div>
              <div className="relative group">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-stone-400 group-focus-within:text-orange-400 transition-colors" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-white border border-stone-200 rounded-2xl py-4 pl-12 pr-4 outline-none focus:ring-2 focus:ring-orange-200 focus:border-orange-400 transition-all text-stone-800 font-medium placeholder:text-stone-300 shadow-sm"
                />
              </div>
            </div>

            <button 
              onClick={() => handleEmailAuth(isHoveringCreate)}
              className="w-full group flex items-center justify-center gap-3 py-4 bg-gradient-to-r from-rose-400 to-orange-400 text-white rounded-2xl font-bold text-lg shadow-xl shadow-orange-500/30 hover:shadow-orange-500/50 hover:-translate-y-1 active:scale-[0.98] transition-all duration-300 mt-4 leading-none"
            >
              <span>{isHoveringCreate ? 'Create Account' : 'Sign In'}</span>
              <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </button>
          </form>

          <p className="text-center mt-8 text-stone-500 text-sm font-medium">
            Don&apos;t have an account?{' '}
            <button 
              onMouseEnter={() => setIsHoveringCreate(true)} 
              onMouseLeave={() => setIsHoveringCreate(false)}
              onClick={() => handleEmailAuth(true)}
              className="text-orange-500 font-bold hover:underline decoration-2 underline-offset-4"
            >
              Create one for free
            </button>
          </p>

        </div>
      </motion.div>
    </div>
  );
}
