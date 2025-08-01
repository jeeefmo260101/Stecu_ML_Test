import React, { useState, useEffect, createContext, useContext } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, getDoc, setDoc, onSnapshot, updateDoc, arrayUnion } from 'firebase/firestore';

// Konteks untuk manajemen state global
const AppContext = createContext();

// --- URL GOOGLE APPS SCRIPT ---
// GANTI DENGAN URL WEB APP GOOGLE APPS SCRIPT ANDA YANG SUDAH DI-DEPLOY
const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwPxMMJScNuzk6ciqQiD5hJ1rcNl2CZfvyEeSDmQtr5b8otwX7TTzol_e9jU3ILyuH0/exec";

// --- FUNGSI HELPER ---
const isModuleAccessible = (module, userProfile, isAdminMode) => {
    // Jika Mode Admin aktif, semua modul bisa diakses
    if (isAdminMode) {
        return { accessible: true, message: "Lihat Modul (Admin)" };
    }
    
    // Cek utama: Apakah modul diaktifkan oleh admin?
    if (!module.isActive) {
        return { accessible: false, message: "Modul belum aktif" };
    }

    // Jika aktif, semua bisa diakses (sesuai permintaan terakhir)
    if (module.type === 'post_test') {
        return { accessible: true, message: "Mulai Post-Test" };
    }
    return { accessible: true, message: "Lihat Modul" };
};


/**
 * Membersihkan array modul sebelum disimpan ke Firestore.
 */
const sanitizeModulesForFirestore = (modulesArray) => {
    if (!Array.isArray(modulesArray)) return [];
    return modulesArray.map(module => {
        const { quiz, ...rest } = module;
        const sanitizedModule = { ...rest };
        Object.keys(sanitizedModule).forEach(key => {
            if (sanitizedModule[key] === undefined) {
                sanitizedModule[key] = null;
            }
        });
        return sanitizedModule;
    });
};

// --- KOMPONEN ERROR ---
const ErrorMessage = ({ message }) => (
    <div className="flex items-center justify-center min-h-screen bg-gray-100 p-4">
        <div className="w-full max-w-2xl p-8 space-y-4 bg-white rounded-lg shadow-md border-l-4 border-red-500">
            <div className="flex items-center">
                <svg className="w-12 h-12 text-red-500 mr-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                <div>
                    <h2 className="text-2xl font-bold text-gray-900">Terjadi Kesalahan</h2>
                    <p className="mt-1 text-gray-600">Aplikasi tidak dapat memuat data dari Google Sheets.</p>
                </div>
            </div>
            <div className="mt-4 p-4 bg-red-50 text-red-800 rounded-md">
                <p className="font-semibold">Detail Masalah:</p>
                <p className="mt-1 break-words">{message}</p>
            </div>
            <div className="mt-6">
                <h3 className="font-bold text-gray-800">Langkah Perbaikan yang Mungkin:</h3>
                <ul className="list-disc list-inside mt-2 text-gray-700 space-y-1">
                    <li>Pastikan URL pada variabel <strong>SCRIPT_URL</strong> di dalam kode sudah benar.</li>
                    <li>Buka kembali project Google Apps Script Anda.</li>
                    <li>Jika skrip Anda adalah "standalone", pastikan Anda menggunakan `SpreadsheetApp.openById('ID_SPREADSHEET_ANDA')`.</li>
                    <li>Klik <strong>Deploy</strong> &gt; <strong>Kelola deployment</strong>.</li>
                    <li>Pilih deployment aktif Anda, klik ikon pensil (Edit).</li>
                    <li>Pada bagian <strong>Siapa yang memiliki akses</strong>, pastikan Anda memilih <strong>"Siapa saja"</strong>.</li>
                    <li>Klik <strong>Deploy</strong> untuk menyimpan versi baru.</li>
                </ul>
            </div>
        </div>
    </div>
);


// --- KOMPONEN UTAMA ---

const AppProvider = ({ children }) => {
    const [currentPage, setCurrentPage] = useState('dashboard');
    const [selectedModule, setSelectedModule] = useState(null);
    const [showQuiz, setShowQuiz] = useState(false);
    const [showSurvey, setShowSurvey] = useState(false);
    const [showCertificateModal, setShowCertificateModal] = useState(false);
    const [modules, setModules] = useState([]);
    const [userScores, setUserScores] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [userProfile, setUserProfile] = useState(null);
    const [userId, setUserId] = useState(null);
    const [db, setDb] = useState(null);
    const [isAuthReady, setIsAuthReady] = useState(false);
    const [isLoggedIn, setIsLoggedIn] = useState(false);
    const [fetchError, setFetchError] = useState(null);
    
    const [isAdmin, setIsAdmin] = useState(false);
    const [isAdminMode, setIsAdminMode] = useState(false);
    // Ganti NIP ini dengan NIP yang akan dijadikan admin
    const ADMIN_NIP = "198404272011011010"; 

    // Inisialisasi Firebase
    useEffect(() => {
        try {
            const firebaseConfigStr = typeof __firebase_config !== 'undefined' ? __firebase_config : '{}';
            const firebaseConfig = JSON.parse(firebaseConfigStr);
            
            if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
                 console.warn("Firebase config is missing or incomplete. Using demo setup.");
                 firebaseConfig.apiKey = "DEMO_KEY";
                 firebaseConfig.projectId = "demo-project";
            }

            const app = initializeApp(firebaseConfig);
            const firestoreDb = getFirestore(app);
            const firebaseAuth = getAuth(app);
            setDb(firestoreDb);

            const unsubscribe = onAuthStateChanged(firebaseAuth, async (user) => {
                let currentUserId;
                if (user) {
                    currentUserId = user.uid;
                } else {
                    if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
                        try {
                            const userCredential = await signInWithCustomToken(firebaseAuth, __initial_auth_token);
                            currentUserId = userCredential.user.uid;
                        } catch (e) {
                            console.error("Custom token sign-in failed, falling back to anonymous", e);
                            const { user: anonUser } = await signInAnonymously(firebaseAuth);
                            currentUserId = anonUser.uid;
                        }
                    } else {
                        const { user: anonUser } = await signInAnonymously(firebaseAuth);
                        currentUserId = anonUser.uid;
                    }
                }
                
                setUserId(currentUserId);
                setIsAuthReady(true);
            });
            return () => unsubscribe();
        } catch (error) {
            console.error("Firebase Init Error:", error);
            setIsLoading(false);
        }
    }, []);

    // Fetch data dari Google Apps Script
    useEffect(() => {
        const fetchData = async () => {
            if (SCRIPT_URL === "MASUKKAN_URL_WEB_APP_GOOGLE_SCRIPT_ANDA_DI_SINI" || SCRIPT_URL === "") {
                const errorMessage = "PENTING: Harap masukkan URL Google Apps Script Anda pada variabel SCRIPT_URL di dalam kode.";
                console.error(errorMessage);
                setFetchError(errorMessage);
                setIsLoading(false);
                return;
            }

            try {
                const [modulesRes, quizzesRes, statusRes] = await Promise.all([
                    fetch(`${SCRIPT_URL}?sheet=Modules`),
                    fetch(`${SCRIPT_URL}?sheet=Quizzes`),
                    fetch(`${SCRIPT_URL}?sheet=ModuleStatus`)
                ]);

                if (!modulesRes.ok || !quizzesRes.ok || !statusRes.ok) {
                    throw new Error('Gagal mengambil data dari Google Sheet.');
                }

                const modulesJson = await modulesRes.json();
                const quizzesJson = await quizzesRes.json();
                const statusJson = await statusRes.json();

                if (!modulesJson.success || !quizzesJson.success || !statusJson.success) {
                    throw new Error('Respon dari Google Script tidak berhasil.');
                }

                const modulesData = modulesJson.data;
                const quizzesData = quizzesJson.data;
                const statuses = statusJson.data.reduce((acc, item) => {
                    acc[item.moduleId] = item.isActive;
                    return acc;
                }, {});

                const fetchedModules = modulesData.map(mod => {
                    const moduleId = mod.id || mod.ID;
                    const dailyQuizQuestions = quizzesData
                        .filter(q => (q.moduleId || q.ModuleID) === moduleId)
                        .slice(0, 5);

                    return {
                        ...mod,
                        isActive: statuses[moduleId] === true || statuses[moduleId] === 'TRUE',
                        day: parseInt(mod.Day, 10) || 1,
                        type: mod.Type || 'daily_material',
                        progress: 0,
                        completed: false,
                        score: null,
                        quizTaken: false,
                        quiz: dailyQuizQuestions.map(q => ({
                            question: q.Question || q.question,
                            options: [
                                q.OptionA || q.optionA, q.OptionB || q.optionB,
                                q.OptionC || q.optionC, q.OptionD || q.optionD
                            ].filter(opt => opt && opt.trim() !== ''),
                            answer: q.CorrectAnswer || q.answer
                        }))
                    };
                });
                setModules(fetchedModules);

            } catch (error) {
                console.error("Fetch Data Error:", error);
                setFetchError(error.message);
                setModules(getStaticModules());
            }
        };

        fetchData();
    }, []);


    // Sinkronisasi data dengan Firestore
    useEffect(() => {
        if (isAuthReady && userId && db && modules.length > 0 && !fetchError) {
            const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
            const userDocRef = doc(db, `artifacts/${appId}/users/${userId}/userData/profile`);

            const unsubscribe = onSnapshot(userDocRef, (docSnap) => {
                if (docSnap.exists()) {
                    const userData = docSnap.data();
                    setUserProfile(userData);
                    setUserScores(userData.scores || []);
                    if (userData.namaLengkap && userData.nip) {
                        setIsLoggedIn(true);
                        // Cek apakah NIP pengguna adalah NIP admin
                        if (userData.nip === ADMIN_NIP) {
                            setIsAdmin(true);
                        } else {
                            setIsAdmin(false);
                        }
                    }
                } else {
                    const modulesToSave = sanitizeModulesForFirestore(modules);
                    const initialProfile = { modules: modulesToSave, scores: [] };
                    setDoc(userDocRef, initialProfile);
                    setUserProfile({ ...initialProfile, modules: modules });
                }
                setIsLoading(false);
            }, (error) => { 
                console.error("Firestore onSnapshot error:", error);
                setIsLoading(false); 
            });

            return () => unsubscribe();
        } else if (fetchError) {
            setIsLoading(false);
        }
    }, [isAuthReady, userId, db, modules.length, fetchError]);

    const handleLogin = async (namaLengkap, nip) => {
        if (!db || !userId || !namaLengkap || !nip) return;
        const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
        const userDocRef = doc(db, `artifacts/${appId}/users/${userId}/userData/profile`);
        try {
            await setDoc(userDocRef, { namaLengkap, nip }, { merge: true });
            setIsLoggedIn(true);
        } catch (error) {
            console.error("Login Error:", error);
        }
    };

    const updateModuleProgress = async (moduleId, newProgress, completedStatus, score = null, quizTaken = false) => {
        if (!db || !userId) return;
        const updatedModules = modules.map(mod => mod.id === moduleId ? { ...mod, progress: newProgress, completed: completedStatus, score, quizTaken } : mod);
        setModules(updatedModules);
        
        const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
        const userDocRef = doc(db, `artifacts/${appId}/users/${userId}/userData/profile`);
        
        try {
            const modulesToSave = sanitizeModulesForFirestore(updatedModules);
            await setDoc(userDocRef, { modules: modulesToSave }, { merge: true });
        } catch (error) {
            console.error("Update Progress Error:", error);
        }
    };

    const addScoreToHistory = async (moduleTitle, score, percentage, totalQuestions) => {
        // 1. Simpan ke Firestore
        if (db && userId) {
            const newScoreEntry = { module: moduleTitle, score, percentage, total: totalQuestions, date: new Date().toISOString().split('T')[0] };
            const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
            const userDocRef = doc(db, `artifacts/${appId}/users/${userId}/userData/profile`);
            try {
                await updateDoc(userDocRef, { scores: arrayUnion(newScoreEntry) });
            } catch (error) {
                console.error("Add Score to Firestore Error:", error);
            }
        }

        // 2. Kirim ke Google Sheet
        if (userProfile && SCRIPT_URL !== "MASUKKAN_URL_WEB_APP_GOOGLE_SCRIPT_ANDA_DI_SINI") {
            const payload = {
                action: 'addResult',
                userProfile: {
                    namaLengkap: userProfile.namaLengkap,
                    nip: userProfile.nip
                },
                scoreData: {
                    module: moduleTitle,
                    score: score,
                    total: totalQuestions,
                    percentage: percentage,
                    date: new Date().toISOString().split('T')[0]
                }
            };
            try {
                await fetch(SCRIPT_URL, {
                    method: 'POST',
                    mode: 'no-cors',
                    body: JSON.stringify(payload),
                    headers: { 'Content-Type': 'application/json' }
                });
                console.log("Data hasil telah dikirim ke Google Sheet.");
            } catch (error) {
                console.error("Error saat mengirim skor ke Google Sheet:", error);
            }
        }
    };
    
    const handleToggleModuleStatus = async (moduleId, newStatus) => {
        // Optimistic UI update
        const updatedModules = modules.map(mod => mod.id === moduleId ? { ...mod, isActive: newStatus } : mod);
        setModules(updatedModules);

        // Send update to Google Apps Script
        try {
            await fetch(SCRIPT_URL, {
                method: 'POST',
                mode: 'no-cors',
                body: JSON.stringify({
                    action: 'updateStatus',
                    moduleId: moduleId,
                    isActive: newStatus
                }),
                headers: { 'Content-Type': 'application/json' }
            });
        } catch (error) {
            console.error("Gagal memperbarui status modul:", error);
            // Revert UI change on failure
            setModules(modules);
        }
    };

    const allModulesCompleted = modules.length > 0 && modules.every(mod => mod.completed);
    
    const value = { currentPage, setCurrentPage, selectedModule, setSelectedModule, showQuiz, setShowQuiz, showSurvey, setShowSurvey, showCertificateModal, setShowCertificateModal, modules, userScores, updateModuleProgress, addScoreToHistory, allModulesCompleted, isLoading, userId, userProfile, isLoggedIn, handleLogin, isAdmin, isAdminMode, setIsAdminMode, fetchError, handleToggleModuleStatus };

    return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};

const LoginPage = () => {
    const { handleLogin } = useContext(AppContext);
    const [nama, setNama] = useState('');
    const [nip, setNip] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!nama.trim() || !nip.trim()) { alert("Nama Lengkap dan NIP tidak boleh kosong."); return; }
        setIsSubmitting(true);
        await handleLogin(nama, nip);
    };
    return (
        <div className="flex items-center justify-center min-h-screen bg-gray-100">
            <div className="w-full max-w-md p-8 space-y-8 bg-white rounded-lg shadow-md">
                <div className="text-center"><h2 className="text-3xl font-bold text-gray-900">Selamat Datang</h2><p className="mt-2 text-gray-600">Silakan masukkan data Anda untuk memulai.</p></div>
                <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
                    <div><label htmlFor="nama-lengkap" className="sr-only">Nama Lengkap</label><input id="nama-lengkap" name="nama" type="text" required className="w-full px-3 py-2 border border-gray-300 rounded-md" placeholder="Nama Lengkap (dengan gelar)" value={nama} onChange={(e) => setNama(e.target.value)} /></div>
                    <div><label htmlFor="nip" className="sr-only">NIP</label><input id="nip" name="nip" type="text" required className="w-full px-3 py-2 border border-gray-300 rounded-md" placeholder="NIP" value={nip} onChange={(e) => setNip(e.target.value)} /></div>
                    <div><button type="submit" disabled={isSubmitting} className="w-full flex justify-center py-2 px-4 border rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300">{isSubmitting ? 'Menyimpan...' : 'Masuk'}</button></div>
                </form>
            </div>
        </div>
    );
};

const AdminToggle = () => {
    const { isAdmin, isAdminMode, setIsAdminMode } = useContext(AppContext);
    if (!isAdmin) return null;
    return (
        <div className="mt-4 p-3 bg-yellow-100 text-yellow-800 rounded-lg">
            <label htmlFor="admin-mode-toggle" className="flex items-center justify-between cursor-pointer">
                <span className="font-semibold">Mode Admin</span>
                <div className="relative">
                    <input type="checkbox" id="admin-mode-toggle" className="sr-only" checked={isAdminMode} onChange={() => setIsAdminMode(!isAdminMode)} />
                    <div className="block bg-gray-300 w-10 h-6 rounded-full"></div>
                    <div className={`dot absolute left-1 top-1 bg-white w-4 h-4 rounded-full transition-transform ${isAdminMode ? 'transform translate-x-full bg-green-500' : ''}`}></div>
                </div>
            </label>
        </div>
    );
};

const Sidebar = () => {
    const { setCurrentPage, userProfile, isAdmin } = useContext(AppContext);
    return (
        <div className="w-64 bg-white shadow-lg h-screen fixed top-0 left-0 flex flex-col p-6 rounded-r-lg">
            <div className="mb-8 text-center">
                <img src="https://storage.googleapis.com/gemini-prod/images/image_e4a04b.png" alt="Logo ST9CU" className="mx-auto mb-4 h-12" />
                <div className="text-xl font-bold text-gray-800">E-Learning SDM</div>
                <div className="text-sm text-gray-500">BPS Provinsi Sumatera Utara</div>
            </div>
            <nav className="flex-grow">
                <ul>
                    <li className="mb-4"><button onClick={() => setCurrentPage('dashboard')} className="flex items-center text-gray-700 hover:text-blue-600 hover:bg-blue-50 rounded-lg p-3 w-full text-left"><svg className="w-6 h-6 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001 1h3v-3m-3 3h3v-3m-3 0V9m0 3h.01M12 10h.01M12 14h.01M12 18h.01"></path></svg>Dashboard</button></li>
                    <li className="mb-4"><button onClick={() => setCurrentPage('modules')} className="flex items-center text-gray-700 hover:text-blue-600 hover:bg-blue-50 rounded-lg p-3 w-full text-left"><svg className="w-6 h-6 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.747 0-3.332.477-4.5 1.253"></path></svg>Modul</button></li>
                    <li className="mb-4"><button onClick={() => setCurrentPage('my-scores')} className="flex items-center text-gray-700 hover:text-blue-600 hover:bg-blue-50 rounded-lg p-3 w-full text-left"><svg className="w-6 h-6 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19V6l12-3v13M9 19c-1.38 0-2.71-.48-4-1.33C2.71 16.67 1.38 16 0 16v-3c1.38 0 2.71.48 4 1.33C5.29 14.33 6.62 15 8 15h1V6L21 3v13"></path></svg>Nilai Saya</button></li>
                    {isAdmin && (
                        <li className="mb-4"><button onClick={() => setCurrentPage('admin-panel')} className="flex items-center text-red-700 hover:text-red-600 hover:bg-red-50 rounded-lg p-3 w-full text-left"><svg className="w-6 h-6 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>Panel Admin</button></li>
                    )}
                </ul>
            </nav>
            <div className="mt-auto">
                <div className="flex items-center p-3 text-gray-700">
                    <div className="w-10 h-10 bg-blue-200 rounded-full flex items-center justify-center text-blue-800 font-bold mr-3">{userProfile?.namaLengkap ? userProfile.namaLengkap.substring(0, 2).toUpperCase() : '??'}</div>
                    <div><div className="font-semibold truncate">{userProfile?.namaLengkap || 'Pengguna'}</div><div className="text-sm text-gray-500">{userProfile?.nip || 'NIP tidak tersedia'}</div></div>
                </div>
                <AdminToggle />
            </div>
        </div>
    );
};

const Header = () => (
    <div className="flex justify-end p-6 bg-white shadow-sm rounded-bl-lg">
        <div className="flex items-center space-x-4">
            <div className="w-10 h-10 bg-gray-200 rounded-full flex items-center justify-center text-gray-600 font-bold">SDU</div>
            <span className="text-gray-700 text-sm">SDU + DN</span>
        </div>
    </div>
);

const Dashboard = () => {
    const { setCurrentPage, setSelectedModule, modules, allModulesCompleted, setShowSurvey, userScores, userProfile, isAdminMode } = useContext(AppContext);
    const dailyModules = modules.filter(m => m.type === 'daily_material');
    const postTestModule = modules.find(m => m.type === 'post_test');
    const totalDailyModules = dailyModules.length;
    const completedDailyModules = dailyModules.filter(mod => mod.completed).length;
    
    const continueLearningModule = dailyModules.find(m => !m.completed) || postTestModule || dailyModules[0];
    const latestScoreEntry = userScores.length > 0 ? userScores[userScores.length - 1] : null;
    const handleStartModule = (module) => {
        if (module) {
            const { accessible } = isModuleAccessible(module, userProfile, isAdminMode);
            if(accessible) { setSelectedModule(module); setCurrentPage('module-detail'); }
        }
    };
    return (
        <div className="p-8 bg-gray-50 min-h-screen rounded-lg">
            <h1 className="text-3xl font-bold text-gray-800 mb-8">Dashboard</h1>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
                <div className="bg-white p-6 rounded-xl shadow-md"><h2 className="text-lg font-semibold">Progres Pembelajaran</h2><p className="text-3xl font-bold my-2">{completedDailyModules}/{totalDailyModules} Modul Harian</p><div className="w-full bg-gray-200 rounded-full h-2.5"><div className="bg-blue-500 h-2.5 rounded-full" style={{ width: totalDailyModules > 0 ? `${(completedDailyModules / totalDailyModules) * 100}%` : '0%' }}></div></div></div>
                <div className="bg-white p-6 rounded-xl shadow-md"><h2 className="text-lg font-semibold">Lanjutkan Belajar</h2><p className="text-xl font-bold my-2">{(continueLearningModule?.Title || continueLearningModule?.title) || 'Tidak ada modul'}</p><button onClick={() => handleStartModule(continueLearningModule)} className="text-blue-600 font-semibold">Mulai Belajar &rarr;</button></div>
                <div className="bg-white p-6 rounded-xl shadow-md"><h2 className="text-lg font-semibold">Skor Terakhir</h2><p className="text-3xl font-bold my-2">{latestScoreEntry ? `${latestScoreEntry.score}/${latestScoreEntry.total}` : 'N/A'}</p><p className="text-sm text-gray-500">{latestScoreEntry?.module || 'Belum ada kuis'}</p></div>
            </div>
            {allModulesCompleted ? (<div className="bg-green-100 border-l-4 border-green-500 text-green-700 p-4 rounded-lg mb-8"><h3 className="font-bold">Selamat! Anda Telah Menyelesaikan Seluruh Program!</h3><p>Silakan lanjutkan ke survei untuk mendapatkan sertifikat Anda.</p></div>) : postTestModule && dailyModules.every(m => m.completed) ? (<div className="bg-yellow-100 border-l-4 border-yellow-500 text-yellow-700 p-4 rounded-lg mb-8"><h3 className="font-bold">Semua Materi Selesai!</h3><p>Jangan lupa untuk mengerjakan Post-Test.</p></div>) : null}
            <div className="bg-white p-8 rounded-xl shadow-md">
                <h2 className="text-2xl font-bold text-gray-800 mb-4">Selamat Datang di E-Learning SDM</h2>
                <p className="text-gray-600 mb-6">Program pembelajaran intensif selama satu bulan untuk meningkatkan kompetensi Anda sebagai ASN.</p>
                {allModulesCompleted && (<div className="mt-6 p-4 bg-green-100 text-green-800 rounded-lg flex items-center justify-between"><span>Langkah terakhir, isi survei singkat kami.</span><button onClick={() => setShowSurvey(true)} className="bg-green-600 text-white font-bold py-2 px-4 rounded-lg">Ikuti Survei</button></div>)}
            </div>
        </div>
    );
};

const LearningModules = () => {
    const { setCurrentPage, setSelectedModule, modules, userProfile, isAdminMode } = useContext(AppContext);
    const handleViewModule = (module) => {
        const { accessible } = isModuleAccessible(module, userProfile, isAdminMode);
        if (accessible) { setSelectedModule(module); setCurrentPage('module-detail'); }
    };
    return (
        <div className="p-8 bg-gray-50 min-h-screen rounded-lg">
            <h1 className="text-3xl font-bold text-gray-800 mb-8">Modul dan Pre-Test</h1>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                {modules.map(module => {
                    const { accessible, message } = isModuleAccessible(module, userProfile, isAdminMode);
                    const isPostTest = module.type === 'post_test';
                    return (
                        <div key={module.id} className={`p-6 rounded-xl shadow-md flex flex-col ${!accessible ? 'bg-gray-100' : 'bg-white'} ${isPostTest ? 'md:col-span-2 lg:col-span-4 bg-blue-50' : ''}`}>
                            <h2 className={`text-xl font-semibold ${!accessible ? 'text-gray-500' : 'text-gray-800'}`}>{module.Title || module.title}</h2>
                            <p className={`my-4 flex-grow ${!accessible ? 'text-gray-400' : 'text-gray-600'}`}>{module.Description || module.description}</p>
                            {!isPostTest && <div className="mb-4"><p className="text-sm text-gray-500 mb-1">Progres: {module.progress}%</p><div className="w-full bg-gray-200 rounded-full h-2.5"><div className="bg-blue-500 h-2.5 rounded-full" style={{ width: `${module.progress}%` }}></div></div></div>}
                            <button onClick={() => handleViewModule(module)} disabled={!accessible} className={`mt-auto w-full text-white font-bold py-2 px-4 rounded-lg ${isPostTest ? 'bg-green-600 hover:bg-green-700' : 'bg-blue-500 hover:bg-blue-600'} disabled:bg-gray-400 disabled:cursor-not-allowed`}>
                                {message}
                            </button>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

const ModuleDetail = () => {
    const { setCurrentPage, selectedModule, modules, setShowQuiz, updateModuleProgress, userProfile, isAdminMode } = useContext(AppContext);

    const currentModule = modules.find(m => m.id === selectedModule?.id);

    if (!currentModule) return <div className="p-8">Modul tidak ditemukan atau sedang disinkronkan...</div>;

    const { accessible, message } = isModuleAccessible(currentModule, userProfile, isAdminMode);
    
    if (!accessible) {
        return (
            <div className="p-8 bg-gray-50 min-h-screen rounded-lg flex flex-col items-center justify-center text-center">
                <svg className="w-16 h-16 text-yellow-500 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                <h1 className="text-2xl font-bold text-gray-700">Modul Terkunci</h1>
                <p className="text-gray-600 mt-2">{message}</p>
                <button onClick={() => setCurrentPage('modules')} className="mt-6 bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded-lg">Kembali</button>
            </div>
        );
    }
    const isPostTest = currentModule.type === 'post_test';
    const handleTakeQuiz = () => setShowQuiz(true);
    const materialContent = currentModule.Material || currentModule.material || "<p>Materi untuk modul ini tidak tersedia.</p>";
    
    return (
        <div className="p-8 bg-gray-50 min-h-screen rounded-lg">
            <button onClick={() => setCurrentPage('modules')} className="flex items-center text-blue-600 mb-6 font-semibold">&larr; Kembali ke Daftar Modul</button>
            <h1 className="text-3xl font-bold text-gray-800 mb-2">{currentModule.Title || currentModule.title}</h1>
            <p className="text-gray-600 mb-6">{currentModule.Description || currentModule.description}</p>
            <div className="bg-white p-8 rounded-xl shadow-md">
                <div className="prose max-w-none" dangerouslySetInnerHTML={{ __html: materialContent }} />
            </div>
            <div className="mt-8 text-right">
                <button 
                    onClick={handleTakeQuiz} 
                    className={`flex items-center ml-auto text-white font-bold py-3 px-6 rounded-full shadow-lg ${isPostTest ? 'bg-green-600 hover:bg-green-700' : 'bg-blue-500 hover:bg-blue-600'}`}
                >
                    {currentModule.quizTaken ? 'Kerjakan Ulang Kuis' : (isPostTest ? 'Mulai Post-Test' : 'Ambil Kuis')}
                    <svg className="w-5 h-5 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"></path></svg>
                </button>
            </div>
        </div>
    );
};

const QuizModal = () => {
    const { selectedModule, setShowQuiz, updateModuleProgress, addScoreToHistory } = useContext(AppContext);
    const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
    const [userAnswers, setUserAnswers] = useState({});
    const [showResult, setShowResult] = useState(false);
    const [score, setScore] = useState(0);
    const handleOptionSelect = (qIndex, option) => setUserAnswers(prev => ({ ...prev, [qIndex]: option }));
    const handleNextQuestion = () => {
        if (currentQuestionIndex < selectedModule.quiz.length - 1) { setCurrentQuestionIndex(prev => prev + 1); } else { calculateScore(); setShowResult(true); }
    };
    const calculateScore = () => {
        let correctAnswers = 0;
        selectedModule.quiz.forEach((q, index) => { if (userAnswers[index] === q.answer) correctAnswers++; });
        const totalQuestions = selectedModule.quiz.length;
        const percentage = totalQuestions > 0 ? (correctAnswers / totalQuestions) * 100 : 0;
        setScore(correctAnswers);
        const moduleTitle = selectedModule.Title || selectedModule.title;
        updateModuleProgress(selectedModule.id, 100, true, correctAnswers, true);
        addScoreToHistory(moduleTitle, correctAnswers, Math.round(percentage), totalQuestions);
    };
    const handleCloseQuiz = () => setShowQuiz(false);
    if (!selectedModule || !selectedModule.quiz || selectedModule.quiz.length === 0) return null;
    const currentQuestion = selectedModule.quiz[currentQuestionIndex];
    return (
        <div className="fixed inset-0 bg-gray-800 bg-opacity-75 flex items-center justify-center p-4 z-50">
            <div className="bg-white p-8 rounded-xl shadow-2xl w-full max-w-lg relative">
                {!showResult ? (
                    <>
                        <h2 className="text-2xl font-bold mb-6">{selectedModule.Title || selectedModule.title}</h2>
                        <p className="text-lg font-semibold mb-3">{currentQuestionIndex + 1}. {currentQuestion.question || "Pertanyaan tidak dimuat."}</p>
                        <div className="space-y-3">
                            {currentQuestion.options.map((opt, idx) => <button key={idx} onClick={() => handleOptionSelect(currentQuestionIndex, opt)} className={`w-full text-left p-3 rounded-lg border ${userAnswers[currentQuestionIndex] === opt ? 'bg-blue-100 border-blue-500' : 'bg-gray-50 hover:bg-gray-100'}`}>{opt}</button>)}
                        </div>
                        <div className="flex justify-between items-center mt-6">
                            <span>Pertanyaan {currentQuestionIndex + 1} dari {selectedModule.quiz.length}</span>
                            <button onClick={handleNextQuestion} disabled={userAnswers[currentQuestionIndex] === undefined} className="bg-blue-500 text-white font-bold py-2 px-5 rounded-lg disabled:opacity-50">{currentQuestionIndex === selectedModule.quiz.length - 1 ? 'Selesai' : 'Berikutnya'}</button>
                        </div>
                    </>
                ) : (
                    <div className="text-center">
                        <h2 className="text-3xl font-bold mb-4">Hasil Ujian</h2>
                        <p className="text-xl mb-6">Anda menjawab benar {score} dari {selectedModule.quiz.length} soal.</p>
                        <p className="text-4xl font-extrabold text-blue-600 mb-8">{Math.round((score / selectedModule.quiz.length) * 100)}%</p>
                        <button onClick={handleCloseQuiz} className="bg-blue-500 text-white font-bold py-3 px-6 rounded-lg">Tutup</button>
                    </div>
                )}
            </div>
        </div>
    );
};

const MyScoreHistory = () => {
    const { userScores } = useContext(AppContext);
    return (
        <div className="p-8 bg-gray-50 min-h-screen rounded-lg">
            <h1 className="text-3xl font-bold text-gray-800 mb-8">Riwayat Skor Saya</h1>
            <div className="bg-white p-6 rounded-xl shadow-md border border-gray-200">
                {userScores.length > 0 ? (
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50"><tr><th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Modul</th><th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Skor</th><th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Persentase</th><th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Tanggal</th></tr></thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {[...userScores].reverse().map((score, index) => (
                                    <tr key={index}>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{score.module}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{score.score}/{score.total}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm"><span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${score.percentage >= 80 ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>{score.percentage}%</span></td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{score.date}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ) : <p className="text-gray-500">Belum ada riwayat kuis.</p>}
            </div>
        </div>
    );
};

const AdminPanel = () => {
    const { modules, handleToggleModuleStatus } = useContext(AppContext);

    return (
        <div className="p-8 bg-gray-50 min-h-screen rounded-lg">
            <h1 className="text-3xl font-bold text-gray-800 mb-8">Panel Admin - Status Modul</h1>
            <div className="bg-white p-6 rounded-xl shadow-md">
                <div className="space-y-4">
                    {modules.map(module => (
                        <div key={module.id} className="flex items-center justify-between p-4 border rounded-lg">
                            <div>
                                <p className="font-semibold text-gray-800">{module.Title || module.title}</p>
                                <p className="text-sm text-gray-500">Hari ke-{module.day}</p>
                            </div>
                            <label htmlFor={`toggle-${module.id}`} className="flex items-center cursor-pointer">
                                <div className="relative">
                                    <input 
                                        type="checkbox" 
                                        id={`toggle-${module.id}`} 
                                        className="sr-only" 
                                        checked={module.isActive} 
                                        onChange={(e) => handleToggleModuleStatus(module.id, e.target.checked)}
                                    />
                                    <div className="block bg-gray-300 w-14 h-8 rounded-full"></div>
                                    <div className={`dot absolute left-1 top-1 bg-white w-6 h-6 rounded-full transition-transform ${module.isActive ? 'transform translate-x-full bg-green-500' : ''}`}></div>
                                </div>
                            </label>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

const SurveyModal = () => {
    const { setShowSurvey, setShowCertificateModal } = useContext(AppContext);
    const handleSubmit = (e) => { e.preventDefault(); setShowSurvey(false); setShowCertificateModal(true); };
    return <div className="fixed inset-0 bg-gray-800 bg-opacity-75 flex items-center justify-center p-4 z-50"><form onSubmit={handleSubmit} className="bg-white p-8 rounded-xl shadow-2xl w-full max-w-lg"><h2 className="text-2xl font-bold mb-6">Survei Kepuasan</h2><p className="mb-6">Terima kasih telah menyelesaikan program pembelajaran ini. Silakan berikan masukan Anda.</p><div className="flex justify-end"><button type="button" onClick={() => setShowSurvey(false)} className="bg-gray-300 text-gray-800 font-bold py-2 px-4 rounded-lg mr-2">Batal</button><button type="submit" className="bg-blue-500 text-white font-bold py-2 px-4 rounded-lg">Lanjut ke Sertifikat</button></div></form></div>
};
const CertificateModal = () => {
    const { setShowCertificateModal } = useContext(AppContext);
    const certificateLink = `https://drive.google.com/drive/folders/1NSJANZwXuR9aA9acz37ta2b2DkG4I2O2?usp=sharing`;
    return <div className="fixed inset-0 bg-gray-800 bg-opacity-75 flex items-center justify-center p-4 z-50"><div className="bg-white p-8 rounded-xl shadow-2xl w-full max-w-lg text-center"><h2 className="text-3xl font-bold text-green-600 mb-4">Selamat!</h2><p className="text-xl text-gray-700 mb-8">Anda telah menyelesaikan seluruh rangkaian program pembelajaran.</p><a href={certificateLink} target="_blank" rel="noopener noreferrer" className="inline-flex items-center bg-green-500 hover:bg-green-600 text-white font-bold py-3 px-6 rounded-lg"><svg className="w-6 h-6 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>Unduh Sertifikat</a><button onClick={() => setShowCertificateModal(false)} className="mt-6 block mx-auto bg-gray-300 hover:bg-gray-400 text-gray-800 font-bold py-2 px-4 rounded-lg">Tutup</button></div></div>
};

const App = () => {
    const { currentPage, showQuiz, showSurvey, showCertificateModal, isLoading, isLoggedIn, fetchError } = useContext(AppContext);
    
    if (fetchError) {
        return <ErrorMessage message={fetchError} />;
    }

    if (isLoading) {
        return <div className="flex justify-center items-center h-screen"><div className="text-xl font-semibold text-gray-600">Memuat data aplikasi...</div></div>;
    }

    return (
        <div className="font-sans antialiased bg-gray-100 min-h-screen">
            {isLoggedIn ? (
                <div className="flex">
                    <Sidebar />
                    <div className="flex-1 ml-64 flex flex-col h-screen">
                        <Header />
                        <main className="flex-1 p-6 overflow-y-auto">
                            {(() => {
                                switch (currentPage) {
                                    case 'dashboard': return <Dashboard />;
                                    case 'modules': return <LearningModules />;
                                    case 'my-scores': return <MyScoreHistory />;
                                    case 'module-detail': return <ModuleDetail />;
                                    case 'admin-panel': return <AdminPanel />;
                                    default: return <Dashboard />;
                                }
                            })()}
                        </main>
                    </div>
                </div>
            ) : (
                <LoginPage />
            )}
            {showQuiz && <QuizModal />}
            {showSurvey && <SurveyModal />}
            {showCertificateModal && <CertificateModal />}
        </div>
    );
};

const getStaticModules = () => [{ day: 1, type: 'daily_material', id: 'fallback-1', Title: 'Fallback Modul (Lokal)', Description: 'Gagal memuat dari Google Sheet.', progress: 0, completed: false, score: null, quizTaken: false, Material: '<h2>Data Lokal</h2>', quiz: [] }];

// Komponen pembungkus utama
export default function WrappedApp() { 
    return (
        <AppProvider>
            <App />
        </AppProvider>
    ); 
}
