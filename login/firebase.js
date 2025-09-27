// firebase.js
// Single, correct firebase init + exports and a Google sign-in helper

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyCt6QiP71FO4O2lf5qP0iIJI7cEczxAGAs",
  authDomain: "arutradex-51dc0.firebaseapp.com",
  projectId: "arutradex-51dc0",
  storageBucket: "arutradex-51dc0.firebasestorage.app",
  messagingSenderId: "681384534051",
  appId: "1:681384534051:web:e0cab72f7a0291f75fd196"
};

// Initialize (only once)
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

// Export for other modules
export { app, auth };

// Google Sign-in helper (used by login page)
export async function signInWithGooglePopup() {
  const provider = new GoogleAuthProvider();
  return signInWithPopup(auth, provider);
}

// Optional: small onAuthStateChanged UI helper if page has .auth container
onAuthStateChanged(auth, (user) => {
  const authDiv = document.querySelector(".auth");
  if (!authDiv) return;
  if (user) {
    authDiv.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;">
        <img src="${user.photoURL || '/assets/default-avatar.png'}" alt="avatar"
             style="width:35px;height:35px;border-radius:50%">
        <span style="color:white;">${user.displayName || "User"}</span>
        <button id="logoutBtn" style="background:#24b27c;color:black;padding:5px 10px;border:none;border-radius:5px;cursor:pointer;">
          Logout
        </button>
      </div>
    `;
    document.getElementById("logoutBtn")?.addEventListener("click", async () => {
      try {
        await signOut(auth);
        window.location.reload();
      } catch (err) {
        console.error("Logout Error:", err);
      }
    });
    
  } else {
    authDiv.innerHTML = `
      <a href="../login/login.html" class="login">Login</a>
      <a href="../login/signup.html" class="signup">Sign Up</a>
    `;
  }
});
