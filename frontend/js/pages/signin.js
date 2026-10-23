document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('signin-form');
  const emailInput = document.getElementById('email');
  const passwordInput = document.getElementById('password');
  const toggleBtn = document.getElementById('toggle-password');
  const errorBanner = document.getElementById('error-message');
  const submitBtn = document.getElementById('submit-btn');

  // Toggle Password Visibility
  toggleBtn.addEventListener('click', () => {
    const isPassword = passwordInput.type === 'password';
    passwordInput.type = isPassword ? 'text' : 'password';
    toggleBtn.textContent = isPassword ? 'Hide' : 'Show';
  });

  // Handle Form Submission
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorBanner.style.display = 'none';
    submitBtn.disabled = true;
    submitBtn.textContent = 'Signing in...';

    try {
      const email = emailInput.value.trim();
      const password = passwordInput.value;

      const response = await AuthService.login(email, password);

      if (response.success) {
        const user = response.user || AuthService.getCurrentUser();
        const role = user?.role;
        if (['admin', 'responder'].includes(role)) {
          window.location.href = 'admin.html';
        } else if (role === 'shelter_manager') {
          window.location.href = 'shelter-manager.html';
        } else {
          window.location.href = 'dashboard.html';
        }
      }
    } catch (error) {
      errorBanner.textContent = error.message || 'Failed to sign in. Please check credentials.';
      errorBanner.style.display = 'block';
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Sign in';
    }
  });

  // Handle 1-Click Demo Login Buttons
  document.querySelectorAll('.btn-demo-login').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      const email = btn.dataset.email;
      const target = btn.dataset.target || 'dashboard.html';
      const defaultPassword = 'Password123!';

      emailInput.value = email;
      passwordInput.value = defaultPassword;
      errorBanner.style.display = 'none';

      const prevText = btn.innerHTML;
      btn.innerHTML = 'Signing in...';
      document.querySelectorAll('.btn-demo-login').forEach(b => b.disabled = true);
      submitBtn.disabled = true;

      try {
        const res = await AuthService.login(email, defaultPassword);
        if (res.success) {
          window.location.href = target;
        } else {
          throw new Error(res.message || 'Login failed');
        }
      } catch (err) {
        errorBanner.textContent = `Demo login failed: ${err.message}. Backend might still be starting.`;
        errorBanner.style.display = 'block';
        btn.innerHTML = prevText;
        document.querySelectorAll('.btn-demo-login').forEach(b => b.disabled = false);
        submitBtn.disabled = false;
      }
    });
  });
});
