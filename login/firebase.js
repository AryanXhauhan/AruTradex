// firebase.js
// Enhanced Firebase client-side config with better state management

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  signOut,
  setPersistence,
  browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyCt6QiP71FO4O2lf5qP0iIJI7cEczxAGAs",
  authDomain: "arutradex-51dc0.firebaseapp.com",
  projectId: "arutradex-51dc0",
  storageBucket: "arutradex-51dc0.firebasestorage.app",
  messagingSenderId: "681384534051",
  appId: "1:681384534051:web:e0cab72f7a0291f75fd196"
};

// Initialize Firebase (only once)
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

// Set persistence to LOCAL (survives browser close)
setPersistence(auth, browserLocalPersistence)
  .then(() => {
    console.log('✅ Firebase auth persistence enabled');
  })
  .catch((error) => {
    console.error('⚠️ Auth persistence error:', error);
  });

// Export for other modules
export { app, auth };

/* -------------------- Google Sign-in Helper -------------------- */

export async function signInWithGooglePopup() {
  try {
    const provider = new GoogleAuthProvider();
    provider.addScope('profile');
    provider.addScope('email');
    
    const result = await signInWithPopup(auth, provider);
    const user = result.user;
    
    // Save user to localStorage for avatar display
    const userData = {
      uid: user.uid,
      email: user.email,
      username: user.displayName,
      name: user.displayName,
      avatarUrl: user.photoURL,
      emailVerified: user.emailVerified,
      lastLogin: new Date().toISOString()
    };
    
    localStorage.setItem('ax-user', JSON.stringify(userData));
    
    // Trigger avatar refresh if main.js is loaded
    if (window.__AX?.avatarRefresh) {
      window.__AX.avatarRefresh();
    }
    
    console.log('✅ Google sign-in successful:', user.displayName);
    return result;
    
  } catch (error) {
    console.error('❌ Google sign-in error:', error);
    
    // User-friendly error messages
    const errorMessages = {
      'auth/popup-closed-by-user': 'Login cancelled. Please try again.',
      'auth/popup-blocked': 'Popup blocked. Please allow popups for this site.',
      'auth/network-request-failed': 'Network error. Check your connection.',
      'auth/too-many-requests': 'Too many attempts. Try again later.'
    };
    
    const message = errorMessages[error.code] || error.message;
    alert(message);
    
    throw error;
  }
}

/* -------------------- Sign Out Helper -------------------- */

export async function signOutUser() {
  try {
    await signOut(auth);
    localStorage.removeItem('ax-user');
    
    console.log('✅ User signed out successfully');
    
    // Trigger avatar refresh
    if (window.__AX?.avatarRefresh) {
      window.__AX.avatarRefresh();
    }
    
    return true;
  } catch (error) {
    console.error('❌ Sign out error:', error);
    throw error;
  }
}

/* -------------------- Auth State Listener -------------------- */

onAuthStateChanged(auth, (user) => {
  console.log('🔐 Auth state changed:', user ? user.email : 'No user');
  
  if (user) {
    // User is signed in - update localStorage
    const userData = {
      uid: user.uid,
      email: user.email,
      username: user.displayName,
      name: user.displayName,
      avatarUrl: user.photoURL,
      emailVerified: user.emailVerified,
      lastLogin: new Date().toISOString()
    };
    
    localStorage.setItem('ax-user', JSON.stringify(userData));
    
    // Update UI if .auth container exists
    updateAuthUI(user);
    
    // Trigger avatar refresh in main.js
    if (window.__AX?.avatarRefresh) {
      window.__AX.avatarRefresh();
    }
    
  } else {
    // User is signed out - clear localStorage
    localStorage.removeItem('ax-user');
    
    // Update UI
    updateAuthUI(null);
    
    // Trigger avatar refresh
    if (window.__AX?.avatarRefresh) {
      window.__AX.avatarRefresh();
    }
  }
});

/* -------------------- UI Update Helper -------------------- */

function updateAuthUI(user) {
  const authDiv = document.querySelector(".auth");
  if (!authDiv) return;
  
  if (user) {
    // Logged in UI
    authDiv.innerHTML = `
      <div class="user-info" style="display:flex;align-items:center;gap:12px;">
        <img src="${user.photoURL || '/assets/default-avatar.png'}" 
             alt="${user.displayName || 'User'}"
             style="width:40px;height:40px;border-radius:50%;border:2px solid #24b27c;object-fit:cover;">
        <div style="display:flex;flex-direction:column;color:white;">
          <span style="font-weight:600;font-size:14px;">${user.displayName || 'User'}</span>
          <span style="font-size:12px;opacity:0.8;">${user.email || ''}</span>
        </div>
        <button id="logoutBtn" 
                style="background:#24b27c;color:#000;padding:8px 16px;border:none;
                       border-radius:8px;cursor:pointer;font-weight:600;margin-left:8px;
                       transition:all 0.3s ease;">
          Logout
        </button>
      </div>
    `;
    
    // Add logout handler
    const logoutBtn = document.getElementById("logoutBtn");
    if (logoutBtn) {
      logoutBtn.addEventListener("click", async () => {
        try {
          await signOutUser();
          window.location.href = '/home/home.html';
        } catch (err) {
          console.error("Logout error:", err);
          alert('Failed to logout. Please try again.');
        }
      });
      
      // Hover effect
      logoutBtn.addEventListener('mouseenter', () => {
        logoutBtn.style.background = '#1f9d68';
        logoutBtn.style.transform = 'scale(1.05)';
      });
      logoutBtn.addEventListener('mouseleave', () => {
        logoutBtn.style.background = '#24b27c';
        logoutBtn.style.transform = 'scale(1)';
      });
    }
    
  } else {
    // Logged out UI
    authDiv.innerHTML = `
      <a href="/login/login.html" class="login" 
         style="color:white;text-decoration:none;padding:8px 16px;
                border:1px solid white;border-radius:8px;transition:all 0.3s;">
        Login
      </a>
      <a href="/signup/signup.html" class="signup"
         style="color:#000;background:#24b27c;text-decoration:none;padding:8px 16px;
                border-radius:8px;font-weight:600;margin-left:10px;transition:all 0.3s;">
        Sign Up
      </a>
    `;
  }
}

/* -------------------- Get Current User Helper -------------------- */

export function getCurrentUser() {
  return auth.currentUser;
}

/* -------------------- Check Auth Status -------------------- */

export function isAuthenticated() {
  return !!auth.currentUser;
}

/* -------------------- Wait for Auth Ready -------------------- */

export function waitForAuth() {
  return new Promise((resolve) => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      unsubscribe();
      resolve(user);
    });
  });
}

console.log('🔥 Firebase initialized successfully');
