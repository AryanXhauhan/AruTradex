document.addEventListener("DOMContentLoaded", () => {
  const closeBtn = document.querySelector(".close-btn");
  const form = document.querySelector("#forgotPasswordForm");
  const errorMsg = document.querySelector("#errorMsg");

  // Go back to login
  closeBtn.addEventListener("click", () => {
    window.location.href = "login.html";
  });

  // Submit form
  form.addEventListener("submit", (e) => {
    e.preventDefault();

    const email = form.querySelector("input[type='email']").value.trim();

    if (!email) {
      errorMsg.textContent = "Please enter your email.";
      errorMsg.style.color = "red";
      return;
    }

    errorMsg.textContent = "Sending reset link...";
    errorMsg.style.color = "#ccc";

    // Simulate request
    fetch("/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    })
      .then(res => {
        if (!res.ok) throw new Error("Request failed");
        return res.json();
      })
      .then(() => {
        errorMsg.textContent = "Reset link sent! Check your email.";
        errorMsg.style.color = "green";
        form.reset();
      })
      .catch(() => {
        errorMsg.textContent = "Failed to send reset link.";
        errorMsg.style.color = "red";
      });
  });
});
