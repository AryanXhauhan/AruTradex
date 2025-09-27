// login.js
import {
  signInWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithPopup,
  signOut
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { auth } from "./firebase.js";

document.addEventListener("DOMContentLoaded", () => {
  const closeBtn = document.querySelector(".close-btn");
  const emailBtn = document.querySelector(".email-btn");
  const googleBtn = document.querySelector(".google-btn");

  // Close -> go to main (adjust path if needed)
  closeBtn?.addEventListener("click", () => {
    window.location.href = "/main.html";
  });

  // Helper: save minimal profile to localStorage under key 'ax-user'
  function saveProfileToLocal(user) {
    try {
      const profile = {
        username: user.displayName || (user.email ? user.email.split("@")[0] : "User"),
        email: user.email || "",
        avatarUrl: user.photoURL || ""
      };
      localStorage.setItem("ax-user", JSON.stringify(profile));
    } catch (e) {
      console.warn("Failed to save profile to localStorage", e);
    }
  }

  // Google login (only for existing users)
  googleBtn?.addEventListener("click", async () => {
    try {
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(auth, provider);

      // If the provider returns a new user flag, block sign-in (per your flow)
      const isNewUser = result?._tokenResponse?.isNewUser;
      if (isNewUser) {
        await signOut(auth);
        alert("User not found. Please sign up first.");
        return;
      }

      // Save profile locally and redirect
      saveProfileToLocal(result.user);
      // Optional: nice toast instead of alert
      // alert("Welcome back!");
      window.location.href = "/main.html";

    } catch (err) {
      console.error("Google sign-in error:", err);
      alert("Google sign-in failed: " + (err.message || err));
    }
  });

  // Toggle email login form
  emailBtn?.addEventListener("click", () => {
    const existingForm = document.querySelector("#loginForm");
    if (existingForm) {
      existingForm.remove();
      return;
    }

    const form = document.createElement("form");
    form.id = "loginForm";
    form.style.marginTop = "10px";
    form.innerHTML = `
      <input type="email" id="email" placeholder="Email" required />
      <input type="password" id="password" placeholder="Password" required />
      <button type="submit" class="login-submit">Login</button>
    `;

    emailBtn.insertAdjacentElement("afterend", form);

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = document.getElementById("email").value.trim();
      const password = document.getElementById("password").value.trim();

      if (!email || !password) {
        alert("Please fill in both fields.");
        return;
      }

      try {
        const cred = await signInWithEmailAndPassword(auth, email, password);
        const user = cred.user;
        // Save profile to localStorage
        saveProfileToLocal(user);

        // alert("Login successful!");
        window.location.href = "/main.html";
      } catch (error) {
        console.error("Login error:", error);
        // Use Firebase error codes
        if (error.code === "auth/user-not-found") {
          alert("User not found. Please sign up first.");
          window.location.href = "/login/signup.html"; // adjust if needed
        } else if (error.code === "auth/wrong-password") {
          alert("Incorrect password. Try again.");
        } else if (error.code === "auth/too-many-requests") {
          alert("Too many attempts. Try again later.");
        } else {
          alert("Login failed: " + (error.message || error.code));
        }
      }
    });
  });
});
