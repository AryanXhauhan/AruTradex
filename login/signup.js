// signup.js
import {
  createUserWithEmailAndPassword,
  fetchSignInMethodsForEmail,
  updateProfile,
  GoogleAuthProvider,
  signInWithPopup,
  signOut
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { auth } from "./firebase.js";

document.addEventListener("DOMContentLoaded", () => {
  const closeBtn = document.querySelector(".close-btn");
  const form = document.querySelector("#signupForm");
  const googleBtn = document.querySelector(".google-btn");

  // Password show/hide toggles
  document.querySelectorAll('.toggle-password').forEach(icon => {
    icon.addEventListener('click', () => {
      const input = document.getElementById(icon.dataset.target);
      const type = input.getAttribute('type') === 'password' ? 'text' : 'password';
      input.setAttribute('type', type);
      icon.classList.toggle('fa-eye');
      icon.classList.toggle('fa-eye-slash');
    });
  });

  closeBtn?.addEventListener("click", () => {
    window.location.href = "login.html";
  });

  // Email signup
  form?.addEventListener("submit", async (e) => {
    e.preventDefault();

    const name = document.getElementById("fullName").value.trim();
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value.trim();
    const confirmPassword = document.getElementById("confirmPassword").value.trim();

    if (!name || !email || !password || !confirmPassword) {
      alert("All fields are required.");
      return;
    }

    if (password !== confirmPassword) {
      alert("Passwords do not match.");
      return;
    }

    try {
      const methods = await fetchSignInMethodsForEmail(auth, email);
      if (methods.length > 0) {
        alert("User already exists. Please login instead.");
        window.location.href = "login.html";
        return;
      }

      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(userCredential.user, { displayName: name });

      alert("Account created successfully!");
      window.location.href = "../home/home.html";

    } catch (error) {
      console.error("Signup error:", error);
      if (error?.code === "auth/weak-password") {
        alert("Weak password. Use at least 6 characters.");
      } else if (error?.code === "auth/email-already-in-use") {
        alert("Email already in use. Try logging in.");
      } else {
        alert("Signup failed: " + (error.message || error.code));
      }
    }
  });

  // Google signup
  googleBtn?.addEventListener("click", async () => {
    try {
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(auth, provider);

      const isNewUser = result?._tokenResponse?.isNewUser;
      if (!isNewUser) {
        await signOut(auth);
        alert("Account already exists. Please log in.");
        window.location.href = "login.html";
        return;
      }

      alert("Google account linked successfully!");
      window.location.href = "../home/home.html";

    } catch (err) {
      console.error("Google signup error:", err);
      alert("Google signup failed: " + (err.message || err));
    }
  });
});
