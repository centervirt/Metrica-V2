// Métrica Dashboard V1 - Client Application Logic (con Autenticación)

const API_BASE = '/api';
let authToken = localStorage.getItem('metrica_token') || null;
let currentUser = null;
let flujoChartInstance = null;
let selectedChartYear = '2026';
let currentGastosList = [];
let currentGastoEnPago = null;
let currentInversionesList = [];
let currentCuentasList = [];
let currentIngresosList = [];
let debounceTimerInversion = null;
let currentEstrategiaDeuda = 'bolaDeNieve';
let catalogoEstrategiasDeuda = null;
let currentMonedaGlobal = localStorage.getItem('metrica_currency') || 'ARS';
let isPrivacyModeActive = localStorage.getItem('metrica_privacy_mode') === 'true';
let cotizacionesDolar = null;
let currentMetasList = [];
let currentPresupuestosList = [];
let ticketSeleccionadoBase64 = null;
let ticketSeleccionadoMimeType = null;
let currentWorkspaceMode = localStorage.getItem('metrica_active_mode') || 'personal';
let currentNegocioClientesList = [];
let currentNegocioFacturasList = [];
let currentNegocioProyectosList = [];
let currentNegocioMonotributoConfig = null;
let currentPricingPeriodo = 'mensual';
let currentContadorClientesList = [];
let currentContadorFiltro = 'todos';
let cachedPricingData = null;

// ==========================================
// CLIENTE HTTP CON AUTENTICACIÓN
// ==========================================

async function authFetch(url, options = {}) {
  const headers = options.headers ? { ...options.headers } : {};
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }

  const res = await fetch(url, { ...options, headers });
  if (res.status === 401) {
    // Sesión vencida o no autorizado
    logout(false);
    showToast('Sesión vencida. Por favor, ingresa nuevamente', 'error');
    openModal('modalAuth');
    throw new Error('No autorizado');
  }
  return res;
}

// Utilidades de formato
function formatMoney(amount) {
  if (isPrivacyModeActive) {
    return currentMonedaGlobal === 'USD' ? 'US$ ••••••' : '$ ••••••';
  }

  const num = Number(amount) || 0;
  if (currentMonedaGlobal === 'USD') {
    // Usar cotización MEP (o Blue) para convertir ARS a USD
    const tipoCambio = (cotizacionesDolar && (cotizacionesDolar.mep?.venta || cotizacionesDolar.blue?.venta)) || 1530;
    const usdAmount = num / (tipoCambio || 1);
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 2
    }).format(usdAmount);
  }

  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  }).format(num);
}

function formatDate(dateString) {
  if (!dateString) return '-';
  const parts = dateString.split('-');
  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  return dateString;
}

function escapeHTML(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ==========================================
// MODO PRIVACIDAD & CONVERSOR MULTIDIVISA
// ==========================================

function toggleModoPrivacidad() {
  isPrivacyModeActive = !isPrivacyModeActive;
  localStorage.setItem('metrica_privacy_mode', isPrivacyModeActive ? 'true' : 'false');
  actualizarIconoPrivacidad();
  loadAllData();
  showToast(isPrivacyModeActive ? 'Modo Privacidad activado (montos ocultos)' : 'Modo Privacidad desactivado');
}

function actualizarIconoPrivacidad() {
  const icon = document.getElementById('iconPrivacy');
  const btn = document.getElementById('btnTogglePrivacy');
  const mobilePrivacyStatus = document.getElementById('mobilePrivacyStatus');

  if (icon) {
    icon.setAttribute('data-lucide', isPrivacyModeActive ? 'eye-off' : 'eye');
  }
  if (btn) {
    if (isPrivacyModeActive) {
      btn.className = 'p-1.5 rounded-xl bg-amber-500/15 border border-amber-500/40 text-amber-300 shadow-[0_0_10px_rgba(245,158,11,0.2)] transition active:scale-95 flex items-center justify-center shrink-0';
      btn.setAttribute('title', 'Modo Privacidad Activo (Clic para ver montos)');
    } else {
      btn.className = 'p-1.5 rounded-xl bg-[#0d1522] hover:bg-[#121c2e] text-slate-400 hover:text-cyan-300 border border-slate-800/80 hover:border-cyan-500/30 transition active:scale-95 flex items-center justify-center shrink-0';
      btn.setAttribute('title', 'Alternar Modo Privacidad (Ocultar montos)');
    }
  }
  if (mobilePrivacyStatus) {
    mobilePrivacyStatus.textContent = isPrivacyModeActive ? 'Oculto' : 'Visible';
    mobilePrivacyStatus.className = isPrivacyModeActive ? 'text-[10px] text-amber-400 font-mono font-bold' : 'text-[10px] text-slate-400 font-mono';
  }
  if (window.lucide) lucide.createIcons();
}

function setMonedaGlobal(moneda) {
  if (moneda !== 'ARS' && moneda !== 'USD') return;
  currentMonedaGlobal = moneda;
  localStorage.setItem('metrica_currency', moneda);
  actualizarBotonesMoneda();
  loadAllData();
  showToast(`Moneda cambiada a ${moneda === 'USD' ? 'Dólares (US$ a tipo MEP)' : 'Pesos Argentinos (ARS $)'}`);
}

function actualizarBotonesMoneda() {
  const btnArs = document.getElementById('btnCurrencyARS');
  const btnUsd = document.getElementById('btnCurrencyUSD');
  if (btnArs && btnUsd) {
    if (currentMonedaGlobal === 'USD') {
      btnUsd.className = 'px-2 py-0.5 rounded-lg bg-cyan-500/20 text-cyan-300 font-bold border border-cyan-400/50 shadow-[0_0_10px_rgba(0,242,254,0.25)] transition';
      btnArs.className = 'px-2 py-0.5 rounded-lg text-slate-400 hover:text-slate-200 transition';
    } else {
      btnArs.className = 'px-2 py-0.5 rounded-lg bg-cyan-500/20 text-cyan-300 font-bold border border-cyan-400/50 shadow-[0_0_10px_rgba(0,242,254,0.25)] transition';
      btnUsd.className = 'px-2 py-0.5 rounded-lg text-slate-400 hover:text-slate-200 transition';
    }
  }
}

async function loadCotizacionesDolar() {
  if (!authToken) return;
  try {
    const res = await authFetch(`${API_BASE}/dolar`);
    if (!res.ok) return;
    const data = await res.json();
    cotizacionesDolar = data.cotizaciones || null;

    const elBlue = document.getElementById('tickerDolarBlue');
    const elMep = document.getElementById('tickerDolarMep');
    const mobileBlue = document.getElementById('mobileTickerBlue');
    const mobileMep = document.getElementById('mobileTickerMep');

    if (cotizacionesDolar) {
      if (cotizacionesDolar.blue) {
        const textBlue = `$ ${Math.round(cotizacionesDolar.blue.venta).toLocaleString('es-AR')}`;
        if (elBlue) elBlue.textContent = textBlue;
        if (mobileBlue) mobileBlue.textContent = textBlue;
      }
      if (cotizacionesDolar.mep || cotizacionesDolar.bolsa) {
        const valMep = (cotizacionesDolar.mep || cotizacionesDolar.bolsa).venta;
        const textMep = `$ ${Math.round(valMep).toLocaleString('es-AR')}`;
        if (elMep) elMep.textContent = textMep;
        if (mobileMep) mobileMep.textContent = textMep;
      }
    }
  } catch (err) {
    console.warn('No se pudo actualizar cotización de dólar:', err);
  }
}

// Control de Notificaciones Toast
function showToast(message, type = 'success') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  const bgClass = type === 'success' ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white';
  toast.className = `pointer-events-auto px-4 py-2.5 rounded-xl shadow-xl text-xs font-medium flex items-center gap-2 transform transition-all duration-300 translate-y-2 opacity-0 ${bgClass}`;
  toast.innerHTML = `<span>${message}</span>`;
  
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.remove('translate-y-2', 'opacity-0');
  }, 10);

  setTimeout(() => {
    toast.classList.add('opacity-0', 'translate-y-2');
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// Control de Modales
function openModal(modalId) {
  if (modalId === 'modalAgenteIA' && currentUser) {
    const esAdmin = Boolean(currentUser.rol === 'admin' || currentUser.plan_suscripcion === 'admin' || (currentUser.trial && currentUser.trial.esAdmin));
    const isTrialActivo = Boolean(currentUser.trial && currentUser.trial.activo);
    const plan = currentUser.plan_suscripcion || 'free';
    if (!esAdmin && !isTrialActivo && plan === 'free') {
      mostrarModalBloqueoPlan('ia');
      return;
    }
  }

  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.remove('hidden');
    modal.style.display = 'flex';

    if (modalId === 'modalAuth') {
      const btnCerrar = document.getElementById('btnCerrarModalAuth');
      if (btnCerrar) {
        if (currentUser) {
          btnCerrar.classList.remove('hidden');
        } else {
          btnCerrar.classList.add('hidden');
        }
      }
    }

    if (modalId === 'modalGasto' && !document.getElementById('inputGastoId')?.value) {
      const elTitulo = document.getElementById('modalGastoTitulo');
      const elBtn = document.getElementById('btnGuardarGastoSubmit');
      if (elTitulo) elTitulo.textContent = 'Registrar Nuevo Gasto';
      if (elBtn) elBtn.textContent = 'Guardar Gasto';
      const form = document.getElementById('formGasto');
      if (form) form.reset();
      const inputGasto = document.getElementById('inputGastoId');
      if (inputGasto) inputGasto.value = '';
    }
    if (modalId === 'modalIngreso') {
      const inputMes = document.getElementById('inputIngresoMes');
      if (inputMes && !inputMes.value) {
        inputMes.value = new Date().toISOString().slice(0, 7);
      }
    }
  }
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.add('hidden');
    modal.style.display = 'none';
  }
}


// Pestañas (Tabs)
function switchTab(tabName) {
  document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
  const activeContent = document.getElementById(`tab-${tabName}`);
  if (activeContent) activeContent.classList.remove('hidden');

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.remove('border-cyan-400', 'text-cyan-300', 'font-bold', 'border-emerald-500', 'text-emerald-400');
    btn.classList.add('border-transparent', 'text-slate-400');
  });
  const activeBtn = document.getElementById(`tabBtn-${tabName}`);
  if (activeBtn) {
    activeBtn.classList.remove('border-transparent', 'text-slate-400');
    activeBtn.classList.add('border-cyan-400', 'text-cyan-300', 'font-bold');
  }

  document.querySelectorAll('.bottom-nav-btn').forEach(btn => {
    btn.classList.remove('text-teal-300', 'font-bold', 'text-emerald-400', 'font-semibold');
    btn.classList.add('text-slate-400');
  });
  const activeBottomBtn = document.getElementById(`bottomNav-${tabName}`);
  if (activeBottomBtn) {
    activeBottomBtn.classList.remove('text-slate-400');
    activeBottomBtn.classList.add('text-teal-300', 'font-bold');
  }

  if (tabName === 'aprender') {
    loadDiagnosticoEducativo();
  }

  if (window.lucide) lucide.createIcons();
}

// ==========================================
// GUÍAS DIDÁCTICAS Y TOUR DE LA PLATAFORMA
// ==========================================

const SECCIONES_GUIA = ['resumen', 'gastos', 'cuentas', 'inversiones', 'ingresos', 'aprender'];

function toggleGuiaSeccion(seccionId) {
  const contenido = document.getElementById(`guiaContenido-${seccionId}`);
  const icon = document.getElementById(`iconToggleGuia-${seccionId}`);
  const label = document.getElementById(`labelToggleGuia-${seccionId}`);
  if (!contenido) return;

  const estaOculto = contenido.classList.contains('hidden');
  if (estaOculto) {
    contenido.classList.remove('hidden');
    if (label) label.textContent = 'Ocultar guía';
    if (icon) icon.setAttribute('data-lucide', 'chevron-up');
    localStorage.setItem(`metrica_guia_oculta_${seccionId}`, 'false');
  } else {
    contenido.classList.add('hidden');
    if (label) label.textContent = 'Ver guía';
    if (icon) icon.setAttribute('data-lucide', 'chevron-down');
    localStorage.setItem(`metrica_guia_oculta_${seccionId}`, 'true');
  }

  if (window.lucide) lucide.createIcons();
}

function initGuiasUsuario() {
  SECCIONES_GUIA.forEach(sec => {
    const oculta = localStorage.getItem(`metrica_guia_oculta_${sec}`) === 'true';
    if (oculta) {
      const contenido = document.getElementById(`guiaContenido-${sec}`);
      const icon = document.getElementById(`iconToggleGuia-${sec}`);
      const label = document.getElementById(`labelToggleGuia-${sec}`);
      if (contenido) contenido.classList.add('hidden');
      if (label) label.textContent = 'Ver guía';
      if (icon) icon.setAttribute('data-lucide', 'chevron-down');
    }
  });

  const tourVisto = localStorage.getItem('metrica_tour_seen');
  const chkAuto = document.getElementById('chkNoMostrarGuiaAuto');
  if (chkAuto && tourVisto === 'true') {
    chkAuto.checked = true;
  }
}

function abrirModalGuiaGeneral() {
  openModal('modalGuiaGeneral');
  setTimeout(() => {
    if (window.lucide) lucide.createIcons();
  }, 50);
}

function confirmarCierreGuiaGeneral() {
  const chkAuto = document.getElementById('chkNoMostrarGuiaAuto');
  if (chkAuto && chkAuto.checked) {
    localStorage.setItem('metrica_tour_seen', 'true');
  }
  closeModal('modalGuiaGeneral');
}

// ==========================================
// AUTENTICACIÓN: LOGIN, REGISTRO, GOOGLE
// ==========================================

function switchAuthTab(tab) {
  const formLogin = document.getElementById('formLogin');
  const formRegister = document.getElementById('formRegister');
  const btnLogin = document.getElementById('authTabBtn-login');
  const btnRegister = document.getElementById('authTabBtn-register');

  if (tab === 'login') {
    formLogin.classList.remove('hidden');
    formRegister.classList.add('hidden');
    btnLogin.classList.add('border-emerald-500', 'text-emerald-400');
    btnLogin.classList.remove('border-transparent', 'text-slate-400');
    btnRegister.classList.remove('border-emerald-500', 'text-emerald-400');
    btnRegister.classList.add('border-transparent', 'text-slate-400');
  } else {
    formLogin.classList.add('hidden');
    formRegister.classList.remove('hidden');
    btnRegister.classList.add('border-emerald-500', 'text-emerald-400');
    btnRegister.classList.remove('border-transparent', 'text-slate-400');
    btnLogin.classList.remove('border-emerald-500', 'text-emerald-400');
    btnLogin.classList.add('border-transparent', 'text-slate-400');
  }
}

function updateAuthUI(user) {
  const userInfoBlock = document.getElementById('userInfoBlock');
  const btnLoginOpen = document.getElementById('btnLoginOpen');
  const userName = document.getElementById('userName');
  const userAvatar = document.getElementById('userAvatar');
  const headerAuthControls = document.getElementById('headerAuthenticatedControls');
  const mobileWorkspaceBar = document.getElementById('mobileWorkspaceBar');
  const bottomNav = document.getElementById('mobileBottomNav') || document.querySelector('nav.md\\:hidden');
  const mainContent = document.getElementById('mainDashboardContent');

  // Elementos de la hoja de perfil mobile
  const mobileProfileAvatar = document.getElementById('mobileProfileAvatar');
  const mobileProfileName = document.getElementById('mobileProfileName');
  const mobileProfileEmail = document.getElementById('mobileProfileEmail');
  const mobileProfilePlanBadge = document.getElementById('mobileProfilePlanBadge');

  if (user) {
    currentUser = user;
    window.scrollTo({ left: 0 });
    if (userInfoBlock) userInfoBlock.classList.remove('hidden');
    if (btnLoginOpen) btnLoginOpen.classList.add('hidden');
    if (headerAuthControls) headerAuthControls.classList.remove('hidden');
    if (mobileWorkspaceBar) mobileWorkspaceBar.classList.remove('hidden');
    if (bottomNav) bottomNav.classList.remove('hidden');
    if (mainContent) mainContent.classList.remove('hidden');
    if (userName) userName.textContent = user.nombre || user.email;

    const initial = (user.nombre || user.email || 'U').charAt(0).toUpperCase();

    if (userAvatar) {
      if (user.avatar_url) {
        userAvatar.innerHTML = `<img src="${user.avatar_url}" alt="Avatar" class="w-full h-full object-cover" />`;
      } else {
        userAvatar.textContent = initial;
      }
    }

    if (mobileProfileName) mobileProfileName.textContent = user.nombre || user.email || 'Usuario';
    if (mobileProfileEmail) mobileProfileEmail.textContent = user.email || '';
    if (mobileProfileAvatar) {
      if (user.avatar_url) {
        mobileProfileAvatar.innerHTML = `<img src="${user.avatar_url}" alt="Avatar" class="w-full h-full object-cover" />`;
      } else {
        mobileProfileAvatar.textContent = initial;
      }
    }

    const badgePlan = document.getElementById('badgeHeaderPlan');
    const plan = user.plan_suscripcion || 'free';
    const esAdmin = Boolean(user.rol === 'admin' || plan === 'admin' || (user.trial && user.trial.esAdmin));
    const isTrial = Boolean(user.trial && user.trial.activo && plan === 'free' && !esAdmin);
    const isExpirado = Boolean(user.trial && user.trial.expirado && plan === 'free' && !esAdmin);

    const labels = {
      free: 'Free',
      pro_personal: 'Pro',
      pro_negocios: 'Negocios',
      contador_partner: 'Partner B2B',
      admin: '👑 Creador'
    };

    if (badgePlan) {
      if (esAdmin) {
        badgePlan.textContent = '👑 Creador';
        badgePlan.className = 'text-[9px] px-2 py-0.5 rounded-full bg-gradient-to-r from-amber-500/30 to-emerald-500/30 text-emerald-300 border border-emerald-500/50 font-bold uppercase shadow-sm';
        badgePlan.title = 'Cuenta Administrador Vitalicio (Acceso Total Ilimitado)';
      } else if (isTrial) {
        badgePlan.textContent = `⏱️ Prueba: ${user.trial.diasRestantes}d`;
        badgePlan.className = 'text-[9px] px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 font-bold';
        badgePlan.title = `Período de prueba completo activo (${user.trial.diasRestantes} días restantes)`;
      } else if (isExpirado) {
        badgePlan.textContent = 'Free (Vencido)';
        badgePlan.className = 'text-[9px] px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/40 font-bold uppercase';
        badgePlan.title = 'Prueba finalizada. Haz clic para activar tu suscripción.';
      } else {
        badgePlan.textContent = labels[plan] || 'Free';
        if (plan === 'contador_partner') {
          badgePlan.className = 'text-[9px] px-1.5 py-0.2 rounded bg-cyan-500/20 text-cyan-300 font-bold uppercase';
        } else if (plan === 'pro_negocios') {
          badgePlan.className = 'text-[9px] px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 font-bold uppercase';
        } else if (plan === 'pro_personal') {
          badgePlan.className = 'text-[9px] px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-400 font-bold uppercase';
        } else {
          badgePlan.className = 'text-[9px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-400 font-bold uppercase';
        }
      }
    }

    if (mobileProfilePlanBadge) {
      if (esAdmin) {
        mobileProfilePlanBadge.textContent = '👑 Administrador / Creador';
        mobileProfilePlanBadge.className = 'text-[10px] px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-bold uppercase shrink-0';
      } else if (isTrial) {
        mobileProfilePlanBadge.textContent = `Prueba Gratuita (${user.trial.diasRestantes} días restantes)`;
        mobileProfilePlanBadge.className = 'text-[10px] px-2.5 py-1 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 font-bold shrink-0';
      } else if (isExpirado) {
        mobileProfilePlanBadge.textContent = 'Free (Prueba Finalizada)';
        mobileProfilePlanBadge.className = 'text-[10px] px-2.5 py-1 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/40 font-bold shrink-0';
      } else {
        mobileProfilePlanBadge.textContent = labels[plan] || 'Free';
        if (plan === 'contador_partner') {
          mobileProfilePlanBadge.className = 'text-[10px] px-2.5 py-1 rounded-full bg-cyan-500/20 text-cyan-300 font-bold uppercase shrink-0';
        } else if (plan === 'pro_negocios') {
          mobileProfilePlanBadge.className = 'text-[10px] px-2.5 py-1 rounded-full bg-amber-500/20 text-amber-300 font-bold uppercase shrink-0';
        } else {
          mobileProfilePlanBadge.className = 'text-[10px] px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-400 font-bold uppercase shrink-0';
        }
      }
    }

  } else {
    currentUser = null;
    if (userInfoBlock) userInfoBlock.classList.add('hidden');
    if (btnLoginOpen) btnLoginOpen.classList.remove('hidden');
    if (headerAuthControls) headerAuthControls.classList.add('hidden');
    if (mobileWorkspaceBar) mobileWorkspaceBar.classList.add('hidden');
    if (bottomNav) bottomNav.classList.add('hidden');
    if (mainContent) mainContent.classList.add('hidden');
    const badgePlan = document.getElementById('badgeHeaderPlan');
    if (badgePlan) {
      badgePlan.textContent = 'Free';
      badgePlan.className = 'text-[9px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-400 font-bold uppercase';
    }
  }
}

function abrirModalPerfilMobile() {
  openModal('modalMobileProfile');
}



async function handleLogin(event) {
  event.preventDefault();
  const form = event.target;
  const formData = new FormData(form);

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: formData.get('email'),
        password: formData.get('password')
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al iniciar sesión');

    authToken = data.token;
    localStorage.setItem('metrica_token', authToken);
    updateAuthUI(data.user);
    closeModal('modalAuth');
    showToast(`¡Bienvenido de nuevo, ${data.user.nombre}!`);
    await loadAllData();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function handleRegister(event) {
  event.preventDefault();
  const form = event.target;
  const formData = new FormData(form);

  try {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nombre: formData.get('nombre'),
        email: formData.get('email'),
        password: formData.get('password')
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al crear cuenta');

    authToken = data.token;
    localStorage.setItem('metrica_token', authToken);
    updateAuthUI(data.user);
    closeModal('modalAuth');
    showToast(`¡Cuenta creada con éxito! Bienvenido, ${data.user.nombre}`);
    await loadAllData();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function loginDemo() {
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'demo@metrica.app', password: 'demo123' })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error con cuenta demo');

    authToken = data.token;
    localStorage.setItem('metrica_token', authToken);
    updateAuthUI(data.user);
    closeModal('modalAuth');
    showToast('Ingresaste como Usuario Demo');
    await loadAllData();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function logout(notify = true) {
  authToken = null;
  currentUser = null;
  localStorage.removeItem('metrica_token');
  updateAuthUI(null);
  resetDashboardView();
  if (notify) showToast('Sesión cerrada');
  openModal('modalAuth');
}

function resetDashboardView() {
  document.getElementById('kpiSaldoTotal').textContent = '$ 0';
  document.getElementById('kpiGastosPendientes').textContent = '$ 0';
  document.getElementById('kpiIngresosMes').textContent = '$ 0';
  document.getElementById('kpiInversiones').textContent = '$ 0';
  document.getElementById('kpiBalanceNeto').textContent = '$ 0';
  
  const tbodyGastos = document.getElementById('tablaGastosBody');
  if (tbodyGastos) tbodyGastos.innerHTML = `<tr><td colspan="6" class="px-5 py-8 text-center text-slate-500">Inicia sesión para ver tus gastos.</td></tr>`;
  const mobileGastos = document.getElementById('listaGastosMobile');
  if (mobileGastos) mobileGastos.innerHTML = `<div class="py-8 text-center text-slate-500 text-xs">Inicia sesión para ver tus gastos.</div>`;

  const gridCuentas = document.getElementById('gridCuentas');
  if (gridCuentas) gridCuentas.innerHTML = `<div class="col-span-full py-8 text-center text-slate-500 text-xs">Inicia sesión para ver tus cuentas.</div>`;

  if (flujoChartInstance) {
    flujoChartInstance.destroy();
    flujoChartInstance = null;
  }
  const elIngresos = document.getElementById('chartTotalIngresos');
  const elGastos = document.getElementById('chartTotalGastos');
  const elBalance = document.getElementById('chartBalanceAnual');
  const elPagado = document.getElementById('chartTotalPagado');
  const elDisponible = document.getElementById('chartTotalDisponible');
  if (elIngresos) elIngresos.textContent = '$ 0';
  if (elGastos) elGastos.textContent = '$ 0';
  if (elBalance) elBalance.textContent = '$ 0';
  if (elPagado) elPagado.textContent = '$ 0';
  if (elDisponible) elDisponible.textContent = '$ 0';
  currentIngresosList = [];
  currentGastosList = [];
  currentCuentasList = [];
  currentInversionesList = [];
}

// Configuración y respuesta de Google Identity Services
async function initGoogleAuth() {
  try {
    const res = await fetch('/api/auth/config');
    const config = await res.json();

    if (config.googleClientId && window.google && window.google.accounts) {
      window.google.accounts.id.initialize({
        client_id: config.googleClientId,
        callback: handleGoogleCredentialResponse,
        auto_select: false
      });

      const container = document.getElementById('googleBtnContainer');
      if (container) {
        container.innerHTML = '';
        window.google.accounts.id.renderButton(container, {
          theme: 'filled_black',
          size: 'large',
          text: 'continue_with',
          shape: 'pill',
          width: 320
        });
      }
    }
  } catch (err) {
    console.error('Error inicializando Google Auth:', err);
  }
}

async function handleGoogleCredentialResponse(response) {
  try {
    const res = await fetch('/api/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: response.credential })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al autenticar con Google');

    authToken = data.token;
    localStorage.setItem('metrica_token', authToken);
    updateAuthUI(data.user);
    closeModal('modalAuth');
    showToast(`Ingresaste con Google: ${data.user.nombre}`);
    await loadAllData();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function handleGooglePromptClick() {
  showToast('Para habilitar Google Sign-In, agrega tu GOOGLE_CLIENT_ID en el archivo .env', 'error');
}

// ==========================================
// CARGA DE DATOS DESDE LA API (PROTEGIDA)
// ==========================================

async function loadResumen() {
  if (!authToken) return;
  try {
    const res = await authFetch(`${API_BASE}/resumen`);
    if (!res.ok) throw new Error('Error al cargar resumen');
    const data = await res.json();

    document.getElementById('kpiSaldoTotal').textContent = formatMoney(data.saldoTotal);
    document.getElementById('kpiGastosPendientes').textContent = formatMoney(data.gastosPendientes);
    document.getElementById('kpiIngresosMes').textContent = formatMoney(data.ingresosProyectadosMes);
    document.getElementById('kpiInversiones').textContent = formatMoney(data.totalInversiones);
    document.getElementById('kpiBalanceNeto').textContent = formatMoney(data.balanceNetoEstimado);

    const currentMonth = new Date().toLocaleDateString('es-AR', { month: 'short', year: 'numeric' });
    document.getElementById('kpiMesLabel').textContent = currentMonth.toUpperCase();

    if (data.gastosProximos) {
      document.getElementById('kpiGastosProximosCount').textContent = data.gastosProximos.length;
    }
  } catch (err) {
    console.error('Error cargando resumen:', err);
  }
}

async function loadGastos() {
  if (!authToken) return;
  try {
    const estado = document.getElementById('filterGastoEstado')?.value || '';
    const categoria = document.getElementById('filterGastoCategoria')?.value || '';

    const params = new URLSearchParams();
    if (estado) params.append('estado', estado);
    if (categoria) params.append('categoria', categoria);

    const res = await authFetch(`${API_BASE}/gastos?${params.toString()}`);
    if (!res.ok) throw new Error('Error al cargar gastos');
    const gastos = await res.json();
    currentGastosList = gastos;

    const tbody = document.getElementById('tablaGastosBody');
    const mobileList = document.getElementById('listaGastosMobile');

    if (!gastos || gastos.length === 0) {
      const emptyMsg = `
        <div class="py-8 text-center text-slate-500 text-xs sm:text-sm bg-slate-900/40 border border-slate-800 rounded-xl">
          No hay gastos registrados con estos filtros.
        </div>`;
      if (tbody) tbody.innerHTML = `<tr><td colspan="6" class="px-5 py-8 text-center text-slate-500">No hay gastos registrados.</td></tr>`;
      if (mobileList) mobileList.innerHTML = emptyMsg;
      return;
    }

    // Render Desktop Table
    if (tbody) {
      tbody.innerHTML = gastos.map(g => {
        let badgeColor = 'bg-slate-800 text-slate-400 border-slate-700';
        if (g.estado === 'pagado') badgeColor = 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
        else if (g.estado === 'proximo') badgeColor = 'bg-amber-500/10 text-amber-400 border-amber-500/20';
        else if (g.estado === 'impago') badgeColor = 'bg-rose-500/10 text-rose-400 border-rose-500/20';

        const catBadge = {
          credito: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20',
          impuesto: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
          operativo: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20'
        }[g.categoria] || 'bg-slate-800 text-slate-400 border-slate-700';

        const progreso = g.monto > 0 ? Math.min(100, Math.round(((g.monto_pagado || 0) / g.monto) * 100)) : 0;
        const restante = Math.max(0, g.monto - (g.monto_pagado || 0));

        return `
          <tr class="hover:bg-slate-800/30 transition">
            <td class="px-5 py-3.5 font-medium text-white">
              <div>${g.nombre}</div>
              ${g.detalles ? `<div class="text-xs text-slate-400 font-normal">${g.detalles}</div>` : ''}
            </td>
            <td class="px-5 py-3.5">
              <span class="text-xs px-2 py-0.5 rounded-full border ${catBadge} uppercase font-semibold">
                ${g.categoria || 'general'}
              </span>
            </td>
            <td class="px-5 py-3.5 text-slate-300 text-xs">
              ${formatDate(g.vencimiento)}
            </td>
            <td class="px-5 py-3.5">
              <div class="font-semibold text-white">${formatMoney(g.monto)}</div>
              ${g.monto_pagado > 0 ? `
                <div class="text-[11px] text-slate-400 flex items-center gap-1.5 mt-0.5">
                  <span>Pagado: ${formatMoney(g.monto_pagado)}</span>
                  <span class="text-emerald-400 font-medium">(${progreso}%)</span>
                </div>
                ${restante > 0 ? `<div class="text-[10px] text-amber-400/90 font-medium">Resta: ${formatMoney(restante)}</div>` : ''}
              ` : ''}
            </td>
            <td class="px-5 py-3.5">
              <span class="text-xs px-2.5 py-0.5 rounded-full border ${badgeColor} font-medium capitalize">
                ${g.estado}
              </span>
            </td>
            <td class="px-5 py-3.5 text-right space-x-1 whitespace-nowrap">
              ${g.estado !== 'pagado' ? `
                <button onclick="abrirModalPago(${g.id})" title="Abonar o liquidar deuda" class="px-2.5 py-1 rounded bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 text-xs font-semibold border border-emerald-500/20 transition active:scale-95 flex-inline items-center gap-1">
                  <i data-lucide="receipt" class="w-3.5 h-3.5 inline -mt-0.5"></i>
                  <span>Abonar</span>
                </button>
              ` : ''}
              <button onclick="abrirModalEditarGasto(${g.id})" title="Editar datos del gasto" class="p-1 text-slate-400 hover:text-cyan-300 rounded hover:bg-slate-800 transition active:scale-95">
                <i data-lucide="edit-3" class="w-4 h-4 inline"></i>
              </button>
              <button onclick="eliminarGasto(${g.id})" title="Eliminar" class="p-1 text-slate-500 hover:text-rose-400 rounded hover:bg-slate-800 transition active:scale-95">
                <i data-lucide="trash-2" class="w-4 h-4 inline"></i>
              </button>
            </td>
          </tr>
        `;
      }).join('');
    }

    // Render Mobile Cards
    if (mobileList) {
      mobileList.innerHTML = gastos.map(g => {
        let badgeColor = 'bg-slate-800 text-slate-400 border-slate-700';
        if (g.estado === 'pagado') badgeColor = 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
        else if (g.estado === 'proximo') badgeColor = 'bg-amber-500/10 text-amber-400 border-amber-500/20';
        else if (g.estado === 'impago') badgeColor = 'bg-rose-500/10 text-rose-400 border-rose-500/20';

        const catBadge = {
          credito: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20',
          impuesto: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
          operativo: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20'
        }[g.categoria] || 'bg-slate-800 text-slate-400 border-slate-700';

        const progreso = g.monto > 0 ? Math.min(100, Math.round(((g.monto_pagado || 0) / g.monto) * 100)) : 0;

        return `
          <div class="bg-slate-900/80 border border-slate-800/90 rounded-xl p-3.5 space-y-2.5">
            <div class="flex justify-between items-start gap-2">
              <div class="min-w-0 flex-1">
                <h4 class="font-semibold text-white text-sm truncate">${g.nombre}</h4>
                <div class="flex flex-wrap items-center gap-1.5 mt-1">
                  <span class="text-[10px] px-2 py-0.5 rounded-full border ${catBadge} uppercase font-semibold">
                    ${g.categoria || 'general'}
                  </span>
                  <span class="text-slate-400 text-[11px]">
                    Vence: ${formatDate(g.vencimiento)}
                  </span>
                </div>
                ${g.detalles ? `<p class="text-[11px] text-slate-400 mt-1">${g.detalles}</p>` : ''}
              </div>
              <div class="text-right shrink-0">
                <div class="font-bold text-white text-base">${formatMoney(g.monto)}</div>
                <span class="text-[10px] px-2 py-0.5 rounded-full border ${badgeColor} font-medium capitalize mt-1 inline-block">
                  ${g.estado}
                </span>
              </div>
            </div>

            ${g.monto_pagado > 0 ? `
              <div class="space-y-1 bg-slate-950/40 p-2 rounded-lg border border-slate-800/60">
                <div class="flex justify-between text-[11px] text-slate-400">
                  <span>Pagado: ${formatMoney(g.monto_pagado)}</span>
                  <span class="text-emerald-400 font-medium">${progreso}%</span>
                </div>
                <div class="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                  <div class="bg-emerald-500 h-full rounded-full" style="width: ${progreso}%"></div>
                </div>
              </div>
            ` : ''}

            <div class="pt-2 border-t border-slate-800/80 flex items-center justify-between">
              ${g.estado !== 'pagado' ? `
                <button onclick="abrirModalPago(${g.id})" class="px-3 py-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 text-xs font-semibold border border-emerald-500/20 active:scale-95 transition flex items-center gap-1.5">
                  <i data-lucide="receipt" class="w-3.5 h-3.5"></i>
                  <span>Abonar / Pagar</span>
                </button>
              ` : `
                <span class="text-xs text-emerald-400 font-medium">✓ Pagado</span>
              `}
              <div class="flex items-center gap-1">
                <button onclick="abrirModalEditarGasto(${g.id})" title="Editar gasto" class="p-1.5 text-slate-400 hover:text-cyan-300 rounded-lg hover:bg-slate-800 active:scale-95 transition">
                  <i data-lucide="edit-3" class="w-4 h-4"></i>
                </button>
                <button onclick="eliminarGasto(${g.id})" title="Eliminar gasto" class="p-1.5 text-slate-500 hover:text-rose-400 rounded-lg hover:bg-slate-800 active:scale-95 transition">
                  <i data-lucide="trash-2" class="w-4 h-4"></i>
                </button>
              </div>
            </div>
          </div>
        `;
      }).join('');
    }

    if (window.lucide) lucide.createIcons();
  } catch (err) {
    console.error('Error cargando gastos:', err);
  }
}

async function loadCuentas() {
  if (!authToken) return;
  try {
    const res = await authFetch(`${API_BASE}/cuentas`);
    if (!res.ok) throw new Error('Error al cargar cuentas');
    const cuentas = await res.json();
    currentCuentasList = cuentas;

    const grid = document.getElementById('gridCuentas');
    const elCuentasCount = document.getElementById('kpiCuentasCount');
    if (elCuentasCount) {
      if (!cuentas || cuentas.length === 0) {
        elCuentasCount.textContent = '¡Conecta tu primera cuenta!';
      } else {
        elCuentasCount.textContent = `${cuentas.length} ${cuentas.length === 1 ? 'cuenta activa' : 'cuentas activas'}`;
      }
    }

    if (!cuentas || cuentas.length === 0) {
      grid.innerHTML = `
        <div class="col-span-full py-8 text-center text-slate-500 text-xs sm:text-sm bg-slate-900/40 border border-slate-800 rounded-xl sm:rounded-2xl">
          No hay cuentas registradas. Toca en "Nueva Cuenta" para registrar una.
        </div>`;
      return;
    }

    grid.innerHTML = cuentas.map(c => `
      <div class="bg-slate-900/70 border border-slate-800 rounded-xl sm:rounded-2xl p-4 sm:p-5 hover:border-slate-700 transition flex flex-col justify-between">
        <div>
          <div class="flex justify-between items-start mb-2 sm:mb-3">
            <div>
              <h4 class="font-semibold text-white text-sm sm:text-base">${c.nombre}</h4>
              <p class="text-xs text-slate-400">${c.banco || 'Billetera Virtual'}</p>
            </div>
            <div class="p-1.5 sm:p-2 rounded-lg bg-emerald-500/10 text-emerald-400 shrink-0">
              <i data-lucide="landmark" class="w-4 h-4"></i>
            </div>
          </div>
          <div class="text-xl sm:text-2xl font-bold text-white mb-2">${formatMoney(c.saldo)}</div>
        </div>
        <div class="pt-3 border-t border-slate-800/80 flex items-center justify-between text-xs">
          <span class="text-slate-500">${c.moneda || 'ARS'}</span>
          <div class="flex items-center gap-1.5">
            <button onclick="abrirModalEditarCuenta(${c.id})" title="Editar cuenta o ajustar saldo" class="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-emerald-400 font-medium text-xs flex items-center gap-1 active:scale-95 transition">
              <i data-lucide="edit-3" class="w-3.5 h-3.5"></i>
              <span>Editar</span>
            </button>
            <button onclick="eliminarCuenta(${c.id})" title="Eliminar cuenta" class="p-1.5 text-slate-500 hover:text-rose-400 rounded-lg hover:bg-slate-800 active:scale-95 transition">
              <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
            </button>
          </div>
        </div>
      </div>
    `).join('');

    if (window.lucide) lucide.createIcons();
  } catch (err) {
    console.error('Error cargando cuentas:', err);
  }
}

async function loadInversiones() {
  if (!authToken) return;
  try {
    const res = await authFetch(`${API_BASE}/inversiones`);
    if (!res.ok) throw new Error('Error al cargar inversiones');
    const inversiones = await res.json();
    currentInversionesList = inversiones;

    document.getElementById('kpiActivosCount').textContent = inversiones.length;
    const tbody = document.getElementById('tablaInversionesBody');
    const mobileList = document.getElementById('listaInversionesMobile');

    if (!inversiones || inversiones.length === 0) {
      const emptyMsg = `
        <div class="py-8 text-center text-slate-500 text-xs sm:text-sm bg-slate-900/40 border border-slate-800 rounded-xl">
          No tienes inversiones registradas aún. Toca en "Agregar Activo" para comenzar.
        </div>`;
      if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="px-5 py-8 text-center text-slate-500">No hay activos registrados.</td></tr>`;
      if (mobileList) mobileList.innerHTML = emptyMsg;
      return;
    }

    // Render Desktop Table
    if (tbody) {
      tbody.innerHTML = inversiones.map(inv => {
        const precioRef = inv.valor_actual || inv.precio_promedio || 0;
        const totalValuado = inv.cantidad * precioRef;
        const gananciaNeta = inv.cantidad * (precioRef - (inv.precio_promedio || 0));
        const rinde = inv.precio_promedio > 0 ? (((precioRef - inv.precio_promedio) / inv.precio_promedio) * 100).toFixed(1) : 0;
        const rindeColor = rinde >= 0 ? 'text-emerald-400' : 'text-rose-400';
        const gananciaSigno = gananciaNeta >= 0 ? '+' : '';
        const tipoBadgeStyles = {
          'Accion': 'bg-sky-500/10 text-sky-400 border-sky-500/20',
          'CEDEAR': 'bg-purple-500/10 text-purple-400 border-purple-500/20',
          'Bono': 'bg-amber-500/10 text-amber-400 border-amber-500/20',
          'Crypto': 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
          'FCI': 'bg-teal-500/10 text-teal-400 border-teal-500/20'
        };
        const badgeClass = tipoBadgeStyles[inv.tipo] || 'bg-slate-800 text-slate-300 border-slate-700';
        const tipoLabel = inv.tipo === 'Accion' ? 'Acción' : (inv.tipo || 'Activo');

        return `
          <tr class="hover:bg-slate-800/30 transition">
            <td class="px-5 py-3.5 font-bold text-white tracking-wide">
              <div>${inv.ticker}</div>
            </td>
            <td class="px-5 py-3.5">
              <span class="text-xs px-2 py-0.5 rounded-full border font-medium ${badgeClass}">
                ${tipoLabel}
              </span>
            </td>
            <td class="px-5 py-3.5 text-slate-300 font-medium">${inv.cantidad}</td>
            <td class="px-5 py-3.5 text-slate-400">${formatMoney(inv.precio_promedio)}</td>
            <td class="px-5 py-3.5 font-medium text-slate-200">
              <div>${formatMoney(inv.valor_actual)}</div>
            </td>
            <td class="px-5 py-3.5">
              <div class="font-bold text-white">${formatMoney(totalValuado)}</div>
              ${rinde != 0 ? `<div class="text-[11px] ${rindeColor} font-medium">${gananciaSigno}${formatMoney(gananciaNeta)} (${gananciaSigno}${rinde}%)</div>` : ''}
            </td>
            <td class="px-5 py-3.5 text-right space-x-1 whitespace-nowrap">
              <button onclick="abrirModalEditarInversion(${inv.id})" title="Editar posición" class="p-1 text-slate-400 hover:text-purple-300 rounded hover:bg-slate-800 transition active:scale-95">
                <i data-lucide="edit-3" class="w-4 h-4 inline"></i>
              </button>
              <button onclick="eliminarInversion(${inv.id})" title="Eliminar" class="p-1 text-slate-500 hover:text-rose-400 rounded hover:bg-slate-800 transition active:scale-95">
                <i data-lucide="trash-2" class="w-4 h-4 inline"></i>
              </button>
            </td>
          </tr>
        `;
      }).join('');
    }

    // Render Mobile Cards
    if (mobileList) {
      mobileList.innerHTML = inversiones.map(inv => {
        const precioRef = inv.valor_actual || inv.precio_promedio || 0;
        const totalValuado = inv.cantidad * precioRef;
        const gananciaNeta = inv.cantidad * (precioRef - (inv.precio_promedio || 0));
        const rinde = inv.precio_promedio > 0 ? (((precioRef - inv.precio_promedio) / inv.precio_promedio) * 100).toFixed(1) : 0;
        const rindeColor = rinde >= 0 ? 'text-emerald-400' : 'text-rose-400';
        const gananciaSigno = gananciaNeta >= 0 ? '+' : '';
        const tipoBadgeStyles = {
          'Accion': 'bg-sky-500/10 text-sky-400 border-sky-500/20',
          'CEDEAR': 'bg-purple-500/10 text-purple-400 border-purple-500/20',
          'Bono': 'bg-amber-500/10 text-amber-400 border-amber-500/20',
          'Crypto': 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
          'FCI': 'bg-teal-500/10 text-teal-400 border-teal-500/20'
        };
        const badgeClass = tipoBadgeStyles[inv.tipo] || 'bg-slate-800 text-slate-300 border-slate-700';
        const tipoLabel = inv.tipo === 'Accion' ? 'Acción' : (inv.tipo || 'Activo');

        return `
          <div class="bg-slate-900/80 border border-slate-800 rounded-xl p-3.5 space-y-2">
            <div class="flex justify-between items-start">
              <div>
                <span class="font-bold text-white text-base tracking-wide">${inv.ticker}</span>
                <span class="text-[10px] px-2 py-0.5 rounded-full border font-medium ml-1.5 ${badgeClass}">
                  ${tipoLabel}
                </span>
                <div class="text-xs text-slate-400 mt-1">${inv.cantidad} unid. &times; ${formatMoney(inv.precio_promedio)}</div>
              </div>
              <div class="text-right">
                <div class="font-bold text-white text-base">${formatMoney(totalValuado)}</div>
                ${rinde != 0 ? `<div class="text-xs ${rindeColor} font-medium">${gananciaSigno}${formatMoney(gananciaNeta)} (${gananciaSigno}${rinde}%)</div>` : ''}
              </div>
            </div>
            <div class="pt-2 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-400">
              <span>Actual: ${formatMoney(inv.valor_actual)}</span>
              <div class="flex items-center gap-1">
                <button onclick="abrirModalEditarInversion(${inv.id})" title="Editar posición" class="p-1.5 text-slate-400 hover:text-purple-300 rounded-lg hover:bg-slate-800 active:scale-95 transition">
                  <i data-lucide="edit-3" class="w-3.5 h-3.5"></i>
                </button>
                <button onclick="eliminarInversion(${inv.id})" title="Eliminar posición" class="p-1.5 text-slate-500 hover:text-rose-400 rounded-lg hover:bg-slate-800 active:scale-95 transition">
                  <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                </button>
              </div>
            </div>
          </div>
        `;
      }).join('');
    }

    if (window.lucide) lucide.createIcons();
  } catch (err) {
    console.error('Error cargando inversiones:', err);
  }
}

async function loadIngresos() {
  if (!authToken) return;
  try {
    const res = await authFetch(`${API_BASE}/ingresos`);
    if (!res.ok) throw new Error('Error al cargar ingresos');
    const ingresos = await res.json();
    currentIngresosList = ingresos || [];

    const tbody = document.getElementById('tablaIngresosBody');
    const mobileList = document.getElementById('listaIngresosMobile');

    if (!ingresos || ingresos.length === 0) {
      const emptyMsg = `
        <div class="py-8 text-center text-slate-500 text-xs sm:text-sm bg-slate-900/40 border border-slate-800 rounded-xl">
          No hay ingresos proyectados registrados.
        </div>`;
      if (tbody) tbody.innerHTML = `<tr><td colspan="5" class="px-5 py-8 text-center text-slate-500">No hay ingresos registrados.</td></tr>`;
      if (mobileList) mobileList.innerHTML = emptyMsg;
      return;
    }

    // Render Desktop Table
    if (tbody) {
      tbody.innerHTML = ingresos.map(ing => {
        const isCobrado = ing.estado === 'cobrado';
        const badgeClass = isCobrado ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-blue-500/10 text-blue-400 border-blue-500/20';

        return `
          <tr class="hover:bg-slate-800/30 transition">
            <td class="px-5 py-3.5 font-medium text-white">${ing.fuente}</td>
            <td class="px-5 py-3.5 text-slate-400 text-xs">${ing.mes}</td>
            <td class="px-5 py-3.5 font-bold text-blue-400">${formatMoney(ing.monto)}</td>
            <td class="px-5 py-3.5">
              <span class="text-xs px-2.5 py-0.5 rounded-full border ${badgeClass} font-medium capitalize">
                ${ing.estado}
              </span>
            </td>
            <td class="px-5 py-3.5 text-right space-x-1">
              ${!isCobrado ? `
                <button onclick="marcarIngresoCobrado(${ing.id})" class="px-2.5 py-1 rounded bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 text-xs font-medium border border-blue-500/20 transition">
                  Cobrado
                </button>
              ` : ''}
              <button onclick="eliminarIngreso(${ing.id})" class="p-1 text-slate-500 hover:text-rose-400 transition">
                <i data-lucide="trash-2" class="w-4 h-4 inline"></i>
              </button>
            </td>
          </tr>
        `;
      }).join('');
    }

    // Render Mobile Cards
    if (mobileList) {
      mobileList.innerHTML = ingresos.map(ing => {
        const isCobrado = ing.estado === 'cobrado';
        const badgeClass = isCobrado ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-blue-500/10 text-blue-400 border-blue-500/20';

        return `
          <div class="bg-slate-900/80 border border-slate-800 rounded-xl p-3.5 space-y-2">
            <div class="flex justify-between items-start">
              <div>
                <h4 class="font-semibold text-white text-sm">${ing.fuente}</h4>
                <div class="text-xs text-slate-400 mt-0.5">Mes: ${ing.mes}</div>
              </div>
              <div class="text-right">
                <div class="font-bold text-blue-400 text-base">${formatMoney(ing.monto)}</div>
                <span class="text-[10px] px-2 py-0.5 rounded-full border ${badgeClass} font-medium capitalize inline-block mt-1">
                  ${ing.estado}
                </span>
              </div>
            </div>
            <div class="pt-2 border-t border-slate-800/80 flex items-center justify-between">
              ${!isCobrado ? `
                <button onclick="marcarIngresoCobrado(${ing.id})" class="px-3 py-1.5 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 text-xs font-semibold border border-blue-500/20 active:scale-95 transition">
                  Marcar Cobrado
                </button>
              ` : `
                <span class="text-xs text-emerald-400 font-medium">✓ Cobrado</span>
              `}
              <button onclick="eliminarIngreso(${ing.id})" class="text-slate-500 hover:text-rose-400 p-1.5 active:scale-95">
                <i data-lucide="trash-2" class="w-4 h-4"></i>
              </button>
            </div>
          </div>
        `;
      }).join('');
    }

    if (window.lucide) lucide.createIcons();
  } catch (err) {
    console.error('Error cargando ingresos:', err);
  }
}

function handleYearChange(year) {
  selectedChartYear = year;
  loadFlujoAnual(year);
}

async function loadFlujoAnual(year = selectedChartYear) {
  if (!authToken) return;
  try {
    const res = await authFetch(`${API_BASE}/flujo-anual?year=${year}`);
    if (!res.ok) throw new Error('Error al cargar flujo anual');
    const data = await res.json();

    const elIngresos = document.getElementById('chartTotalIngresos');
    const elGastos = document.getElementById('chartTotalGastos');
    const elBalance = document.getElementById('chartBalanceAnual');
    const elPagado = document.getElementById('chartTotalPagado');
    const elDisponible = document.getElementById('chartTotalDisponible');

    if (elIngresos) elIngresos.textContent = formatMoney(data.totalIngresosAnual);
    if (elGastos) elGastos.textContent = formatMoney(data.totalGastosAnual);
    if (elPagado) elPagado.textContent = formatMoney(data.totalPagadoAnual || 0);
    if (elDisponible) elDisponible.textContent = formatMoney(data.totalDineroDisponibleAnual || 0);
    if (elBalance) {
      const signo = data.balanceAnual >= 0 ? '+' : '';
      elBalance.textContent = `${signo}${formatMoney(data.balanceAnual)}`;
      elBalance.className = `text-xs font-bold ${data.balanceAnual >= 0 ? 'text-emerald-400' : 'text-rose-400'}`;
    }

    currentFlujoAnualData = data;
    renderFlujoAnualChart(data);
  } catch (err) {
    console.error('Error cargando gráfico de flujo:', err);
  }
}

let currentFlujoAnualData = null;
let currentChartType = 'line'; // 'line', 'bar', 'doughnut'

function setChartType(type) {
  if (type !== 'line' && type !== 'bar' && type !== 'doughnut') return;
  currentChartType = type;

  const btnLine = document.getElementById('btnChartTypeLine');
  const btnBar = document.getElementById('btnChartTypeBar');
  const btnPie = document.getElementById('btnChartTypePie');

  const activoClass = 'px-2 sm:px-2.5 py-1 rounded-lg bg-cyan-500/20 text-cyan-300 font-bold border border-cyan-400/50 shadow-[0_0_8px_rgba(0,242,254,0.2)] transition flex items-center gap-1.5';
  const inactivoClass = 'px-2 sm:px-2.5 py-1 rounded-lg text-slate-400 hover:text-white transition flex items-center gap-1.5';

  if (btnLine) btnLine.className = type === 'line' ? activoClass : inactivoClass;
  if (btnBar) btnBar.className = type === 'bar' ? activoClass : inactivoClass;
  if (btnPie) btnPie.className = type === 'doughnut' ? activoClass : inactivoClass;

  if (currentFlujoAnualData) {
    renderFlujoAnualChart(currentFlujoAnualData);
  }
  if (window.lucide) lucide.createIcons();
}

function renderFlujoAnualChart(data) {
  const canvas = document.getElementById('chartFlujoAnual');
  if (!canvas || !window.Chart) return;
  const ctx = canvas.getContext('2d');

  if (flujoChartInstance) {
    flujoChartInstance.destroy();
  }

  // MODO 1: GRÁFICO DE TORTA / DOUGHNUT (DISTRIBUCIÓN)
  if (currentChartType === 'doughnut') {
    const totalDisp = Math.max(0, data.totalDineroDisponibleAnual || 0);
    const totalPagado = Math.max(0, data.totalPagadoAnual || 0);
    const totalPendiente = Math.max(0, (data.totalGastosAnual || 0) - totalPagado);

    const labels = ['Disponible / Superávit', 'Gastos Ya Pagados', 'Gastos Por Vencer'];
    const valores = [totalDisp, totalPagado, totalPendiente];
    const colores = [
      'rgba(45, 212, 191, 0.85)', // Teal neón
      'rgba(56, 189, 248, 0.85)', // Cyan brillante
      'rgba(244, 63, 94, 0.85)'   // Coral neón
    ];
    const bordes = ['#090e17', '#090e17', '#090e17'];

    flujoChartInstance = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: labels,
        datasets: [{
          data: valores,
          backgroundColor: colores,
          borderColor: bordes,
          borderWidth: 3,
          hoverOffset: 10
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '65%',
        plugins: {
          legend: {
            display: true,
            position: 'top',
            align: 'center',
            labels: {
              color: '#cbd5e1',
              boxWidth: 12,
              usePointStyle: true,
              font: { size: 11, family: 'Inter', weight: '600' },
              padding: 16
            }
          },
          tooltip: {
            backgroundColor: 'rgba(9, 14, 23, 0.96)',
            titleColor: '#f8fafc',
            bodyColor: '#cbd5e1',
            borderColor: '#1a273a',
            borderWidth: 1,
            padding: 12,
            cornerRadius: 12,
            callbacks: {
              label: function(context) {
                const total = context.dataset.data.reduce((a, b) => a + b, 0) || 1;
                const pct = ((context.parsed / total) * 100).toFixed(1);
                return ` ${context.label}: ${formatMoney(context.parsed)} (${pct}%)`;
              }
            }
          }
        }
      }
    });
    return;
  }

  // MODO 2: GRÁFICO DE BARRAS (COMPARATIVA MENSUAL)
  if (currentChartType === 'bar') {
    flujoChartInstance = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: data.meses,
        datasets: [
          {
            label: 'Ingresos',
            data: data.ingresos,
            backgroundColor: 'rgba(45, 212, 191, 0.75)',
            borderColor: '#2dd4bf',
            borderWidth: 1.5,
            borderRadius: 5
          },
          {
            label: 'Dinero Disponible',
            data: data.dineroDisponible || data.ingresos,
            backgroundColor: 'rgba(245, 158, 11, 0.75)',
            borderColor: '#f59e0b',
            borderWidth: 1.5,
            borderRadius: 5
          },
          {
            label: 'Gastos Totales',
            data: data.gastos,
            backgroundColor: 'rgba(244, 63, 94, 0.75)',
            borderColor: '#f43f5e',
            borderWidth: 1.5,
            borderRadius: 5
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            display: true,
            position: 'top',
            align: 'end',
            labels: { color: '#94a3b8', boxWidth: 10, usePointStyle: true, font: { size: 11, family: 'Inter' } }
          },
          tooltip: {
            backgroundColor: 'rgba(9, 14, 23, 0.96)',
            titleColor: '#f8fafc',
            bodyColor: '#cbd5e1',
            borderColor: '#1a273a',
            borderWidth: 1,
            padding: 10,
            boxPadding: 5,
            cornerRadius: 12,
            usePointStyle: true,
            callbacks: {
              label: function(context) {
                return ` ${context.dataset.label}: ${formatMoney(context.parsed.y)}`;
              }
            }
          }
        },
        scales: {
          x: {
            grid: { color: 'rgba(26, 39, 58, 0.45)', drawBorder: false },
            ticks: { color: '#94a3b8', font: { size: 11, family: 'Inter' } }
          },
          y: {
            grid: { color: 'rgba(26, 39, 58, 0.45)', drawBorder: false },
            ticks: {
              color: '#94a3b8',
              font: { size: 10, family: 'Inter' },
              callback: function(val) { return formatMoney(val).replace(',00', ''); }
            }
          }
        }
      }
    });
    return;
  }

  // MODO 3: GRÁFICO DE LÍNEAS NEÓN (POR DEFECTO)
  const gradIngresos = ctx.createLinearGradient(0, 0, 0, 240);
  gradIngresos.addColorStop(0, 'rgba(45, 212, 191, 0.22)');
  gradIngresos.addColorStop(1, 'rgba(45, 212, 191, 0.00)');

  const gradGastos = ctx.createLinearGradient(0, 0, 0, 240);
  gradGastos.addColorStop(0, 'rgba(244, 63, 94, 0.20)');
  gradGastos.addColorStop(1, 'rgba(244, 63, 94, 0.00)');

  const gradDisponible = ctx.createLinearGradient(0, 0, 0, 240);
  gradDisponible.addColorStop(0, 'rgba(245, 158, 11, 0.22)');
  gradDisponible.addColorStop(1, 'rgba(245, 158, 11, 0.00)');

  flujoChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: data.meses,
      datasets: [
        {
          label: 'Ingresos',
          data: data.ingresos,
          borderColor: '#2dd4bf',
          backgroundColor: gradIngresos,
          borderWidth: 2.5,
          pointBackgroundColor: '#2dd4bf',
          pointBorderColor: '#090e17',
          pointBorderWidth: 2,
          pointRadius: 4,
          pointHoverRadius: 6.5,
          fill: false,
          tension: 0.4
        },
        {
          label: 'Dinero Disponible',
          data: data.dineroDisponible || data.ingresos,
          borderColor: '#f59e0b',
          backgroundColor: gradDisponible,
          borderWidth: 2.5,
          pointBackgroundColor: '#f59e0b',
          pointBorderColor: '#090e17',
          pointBorderWidth: 2,
          pointRadius: 4,
          pointHoverRadius: 6.5,
          fill: true,
          tension: 0.4
        },
        {
          label: 'Gastos Totales',
          data: data.gastos,
          borderColor: '#f43f5e',
          backgroundColor: gradGastos,
          borderWidth: 2.5,
          pointBackgroundColor: '#f43f5e',
          pointBorderColor: '#090e17',
          pointBorderWidth: 2,
          pointRadius: 4,
          pointHoverRadius: 6.5,
          fill: false,
          tension: 0.4
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false
      },
      plugins: {
        legend: {
          display: true,
          position: 'top',
          align: 'end',
          labels: {
            color: '#94a3b8',
            boxWidth: 10,
            usePointStyle: true,
            font: { size: 11, family: 'Inter' }
          }
        },
        tooltip: {
          backgroundColor: 'rgba(9, 14, 23, 0.96)',
          titleColor: '#f8fafc',
          bodyColor: '#cbd5e1',
          borderColor: '#1a273a',
          borderWidth: 1,
          padding: 10,
          boxPadding: 5,
          cornerRadius: 12,
          usePointStyle: true,
          callbacks: {
            label: function(context) {
              return ` ${context.dataset.label}: ${formatMoney(context.parsed.y)}`;
            },
            afterBody: function(items) {
              const ing = items.find(i => i.dataset.label === 'Ingresos')?.parsed.y || 0;
              const disp = items.find(i => i.dataset.label === 'Dinero Disponible')?.parsed.y || 0;
              const gas = items.find(i => i.dataset.label === 'Gastos Totales')?.parsed.y || 0;
              const pagado = ing - disp;
              const restanteComprometido = Math.max(0, gas - pagado);

              return [
                ` Ya Pagado en efectivo: ${formatMoney(pagado)}`,
                ` Deuda viva por pagar: ${formatMoney(restanteComprometido)}`
              ];
            }
          }
        }
      },
      scales: {
        x: {
          grid: {
            color: 'rgba(26, 39, 58, 0.45)',
            drawBorder: false
          },
          ticks: {
            color: '#94a3b8',
            font: { size: 11, family: 'Inter' }
          }
        },
        y: {
          grid: {
            color: 'rgba(26, 39, 58, 0.45)',
            drawBorder: false
          },
          ticks: {
            color: '#94a3b8',
            font: { size: 10, family: 'Inter' },
            callback: function(val) {
              return formatMoney(val).replace(',00', '');
            }
          }
        }
      }
    }
  });
}

// ==========================================
// ASISTENTE DE CONFIGURACIÓN DINÁMICO
// ==========================================
let pasoActualAsistente = 1;

function actualizarAsistenteConfiguracion() {
  const badge = document.getElementById('badgeAsistenteProgreso');
  const titulo = document.getElementById('tituloAsistentePaso');
  const desc = document.getElementById('descAsistentePaso');
  const btnTexto = document.getElementById('textoAsistenteAccion');
  const icon = document.getElementById('iconAsistentePaso');
  const iconContainer = document.getElementById('iconAsistenteContainer');
  if (!badge || !titulo || !btnTexto) return;

  const tieneIngresos = currentIngresosList && currentIngresosList.length > 0;
  const tieneCuentas = currentCuentasList && currentCuentasList.length > 0;
  const tieneGastos = currentGastosList && currentGastosList.length > 0;

  if (!tieneIngresos) {
    pasoActualAsistente = 1;
    badge.textContent = 'Paso 1 de 3';
    badge.className = 'text-[10px] font-mono px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-300 border border-cyan-500/30 font-semibold';
    titulo.textContent = '1. Carga tu Ingreso Principal';
    desc.textContent = 'Define tu sueldo mensual o cobros fijos para activar tus proyecciones';
    btnTexto.textContent = 'Carga tu Ingreso Principal';
    if (icon) icon.setAttribute('data-lucide', 'coins');
    if (iconContainer) iconContainer.className = 'w-11 h-11 rounded-xl bg-teal-500/10 text-teal-400 border border-teal-500/20 flex items-center justify-center shrink-0';
  } else if (!tieneCuentas) {
    pasoActualAsistente = 2;
    badge.textContent = 'Paso 2 de 3';
    badge.className = 'text-[10px] font-mono px-2 py-0.5 rounded-full bg-teal-500/10 text-teal-300 border border-teal-500/30 font-semibold';
    titulo.textContent = '2. Conecta tus Cuentas y Bancos';
    desc.textContent = 'Agrega tus billeteras virtuales o bancos para controlar tu saldo real';
    btnTexto.textContent = 'Conectar Cuenta';
    if (icon) icon.setAttribute('data-lucide', 'landmark');
    if (iconContainer) iconContainer.className = 'w-11 h-11 rounded-xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 flex items-center justify-center shrink-0';
  } else if (!tieneGastos) {
    pasoActualAsistente = 3;
    badge.textContent = 'Paso 3 de 3';
    badge.className = 'text-[10px] font-mono px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-300 border border-amber-500/30 font-semibold';
    titulo.textContent = '3. Registra tus Gastos y Vencimientos';
    desc.textContent = 'Carga tus servicios, tarjetas o alquileres para alertar vencimientos';
    btnTexto.textContent = 'Registrar Gasto';
    if (icon) icon.setAttribute('data-lucide', 'receipt');
    if (iconContainer) iconContainer.className = 'w-11 h-11 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20 flex items-center justify-center shrink-0';
  } else {
    pasoActualAsistente = 4;
    badge.textContent = '¡Completado!';
    badge.className = 'text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/40 font-bold';
    titulo.textContent = '🎉 Finanzas Sincronizadas y Activas';
    desc.textContent = 'Tus ingresos, cuentas y gastos están conectados con tu panel general';
    btnTexto.textContent = '+ Nuevo Movimiento';
    if (icon) icon.setAttribute('data-lucide', 'shield-check');
    if (iconContainer) iconContainer.className = 'w-11 h-11 rounded-xl bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 flex items-center justify-center shrink-0';
  }

  if (window.lucide) lucide.createIcons();
}

function ejecutarAccionAsistente() {
  if (pasoActualAsistente === 1) {
    openModal('modalIngreso');
  } else if (pasoActualAsistente === 2) {
    openModal('modalCuenta');
  } else if (pasoActualAsistente === 3) {
    openModal('modalGasto');
  } else {
    openModal('modalMobileActions');
  }
}

function abrirModalSegunPasoAsistente() {
  if (pasoActualAsistente === 1) {
    switchTab('ingresos');
  } else if (pasoActualAsistente === 2) {
    switchTab('cuentas');
  } else if (pasoActualAsistente === 3) {
    switchTab('gastos');
  } else {
    openModal('modalMobileActions');
  }
}

async function loadAllData() {
  if (!authToken) return;
  await Promise.all([
    loadResumen(),
    loadGastos(),
    loadCuentas(),
    loadInversiones(),
    loadIngresos(),
    loadFlujoAnual(),
    loadDiagnosticoEducativo(),
    loadCotizacionesDolar(),
    loadMetas(),
    loadPresupuestos()
  ]);
  actualizarAsistenteConfiguracion();
  showToast('Datos actualizados');
}

// ==========================================
// ACCIONES Y FORMULARIOS
// ==========================================

function abrirModalEditarGasto(id) {
  const gasto = (currentGastosList || []).find(g => g.id === id);
  if (!gasto) {
    showToast('No se encontró el gasto a editar', 'error');
    return;
  }

  const elTitulo = document.getElementById('modalGastoTitulo');
  const elBtn = document.getElementById('btnGuardarGastoSubmit');
  const inputId = document.getElementById('inputGastoId');
  const inputNombre = document.getElementById('inputGastoNombre');
  const inputMonto = document.getElementById('inputGastoMonto');
  const selectCat = document.getElementById('inputGastoCategoria');
  const inputVenc = document.getElementById('inputGastoVencimiento');
  const selectEst = document.getElementById('inputGastoEstado');
  const inputDet = document.getElementById('inputGastoDetalles');

  if (elTitulo) elTitulo.textContent = 'Editar Gasto / Deuda';
  if (elBtn) elBtn.textContent = 'Actualizar Gasto';

  if (inputId) inputId.value = gasto.id;
  if (inputNombre) inputNombre.value = gasto.nombre || '';
  if (inputMonto) inputMonto.value = gasto.monto || '';
  if (selectCat) selectCat.value = gasto.categoria || 'credito';
  if (inputVenc) inputVenc.value = gasto.vencimiento || '';
  if (selectEst) selectEst.value = gasto.estado || 'impago';
  if (inputDet) inputDet.value = gasto.detalles || '';

  openModal('modalGasto');
  if (inputNombre) inputNombre.focus();
}

async function handleGuardarGasto(event) {
  event.preventDefault();
  const form = event.target;
  const formData = new FormData(form);
  const gastoId = formData.get('id');

  const payload = {
    nombre: formData.get('nombre'),
    monto: parseFloat(formData.get('monto')),
    categoria: formData.get('categoria'),
    vencimiento: formData.get('vencimiento') || null,
    estado: formData.get('estado') || 'impago',
    detalles: formData.get('detalles') || null
  };

  try {
    const isEdit = Boolean(gastoId);
    const url = isEdit ? `${API_BASE}/gastos/${gastoId}` : `${API_BASE}/gastos`;
    const method = isEdit ? 'PUT' : 'POST';

    const res = await authFetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) throw new Error(isEdit ? 'Error actualizando gasto' : 'Error guardando gasto');

    closeModal('modalGasto');
    form.reset();
    document.getElementById('inputGastoId').value = '';
    showToast(isEdit ? 'Gasto actualizado con éxito' : 'Gasto registrado con éxito');
    await loadAllData();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function handleCrearGasto(event) {
  // Alias de compatibilidad
  return handleGuardarGasto(event);
}

function abrirModalCrearCuenta() {
  const form = document.getElementById('formCuenta');
  if (form) form.reset();
  const inputId = document.getElementById('inputCuentaId');
  if (inputId) inputId.value = '';
  const titulo = document.getElementById('modalCuentaTitulo');
  if (titulo) titulo.textContent = 'Registrar Cuenta o Billetera';
  const btn = document.getElementById('btnGuardarCuentaSubmit');
  if (btn) btn.textContent = 'Guardar Cuenta';
  openModal('modalCuenta');
  setTimeout(() => {
    document.getElementById('inputCuentaNombre')?.focus();
  }, 100);
}

function abrirModalEditarCuenta(id) {
  const cuenta = currentCuentasList?.find(c => c.id === id);
  if (!cuenta) {
    showToast('No se encontró la información de la cuenta', 'error');
    return;
  }

  const inputId = document.getElementById('inputCuentaId');
  const inputNombre = document.getElementById('inputCuentaNombre');
  const inputBanco = document.getElementById('inputCuentaBanco');
  const inputSaldo = document.getElementById('inputCuentaSaldo');
  const titulo = document.getElementById('modalCuentaTitulo');
  const btn = document.getElementById('btnGuardarCuentaSubmit');

  if (inputId) inputId.value = cuenta.id;
  if (inputNombre) inputNombre.value = cuenta.nombre || '';
  if (inputBanco) inputBanco.value = cuenta.banco || '';
  if (inputSaldo) inputSaldo.value = cuenta.saldo || 0;
  if (titulo) titulo.textContent = 'Editar Cuenta o Ajustar Saldo';
  if (btn) btn.textContent = 'Actualizar Cuenta';

  openModal('modalCuenta');
  setTimeout(() => {
    if (inputSaldo) {
      inputSaldo.focus();
      inputSaldo.select();
    }
  }, 100);
}

async function handleGuardarCuenta(event) {
  event.preventDefault();
  const form = event.target;
  const formData = new FormData(form);
  const cuentaId = formData.get('id');

  const payload = {
    nombre: formData.get('nombre'),
    banco: formData.get('banco') || null,
    saldo: parseFloat(formData.get('saldo')) || 0
  };

  try {
    const isEdit = Boolean(cuentaId);
    const url = isEdit ? `${API_BASE}/cuentas/${cuentaId}` : `${API_BASE}/cuentas`;
    const method = isEdit ? 'PUT' : 'POST';

    const res = await authFetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) throw new Error(isEdit ? 'Error actualizando cuenta' : 'Error guardando cuenta');

    closeModal('modalCuenta');
    form.reset();
    document.getElementById('inputCuentaId').value = '';
    showToast(isEdit ? 'Cuenta y saldo actualizados con éxito' : 'Cuenta registrada con éxito');
    await loadAllData();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function handleCrearCuenta(event) {
  return handleGuardarCuenta(event);
}

// ==========================================
// CONTROL DEL MODAL DE INVERSIONES Y MERCADO
// ==========================================

let cotizacionDetectadaTmp = null;

function abrirModalInversionNuevo() {
  const form = document.getElementById('formInversion');
  if (form) form.reset();
  document.getElementById('inputInvId').value = '';
  document.getElementById('boxCotizacionDetectada').classList.add('hidden');
  cotizacionDetectadaTmp = null;
  recalcularRendimientoModal();
  openModal('modalInversion');
  setTimeout(() => {
    const el = document.getElementById('inputInvTicker');
    if (el) el.focus();
  }, 100);
}

function abrirModalEditarInversion(id) {
  const inv = (currentInversionesList || []).find(i => i.id === id);
  if (!inv) {
    showToast('No se encontró la posición a editar', 'error');
    return;
  }

  document.getElementById('inputInvId').value = inv.id;
  document.getElementById('inputInvTicker').value = inv.ticker || '';
  document.getElementById('inputInvTipo').value = inv.tipo || 'CEDEAR';
  document.getElementById('inputInvCantidad').value = inv.cantidad || '';
  document.getElementById('inputInvPrecioCompra').value = inv.precio_promedio || '';
  document.getElementById('inputInvValorActual').value = inv.valor_actual || '';

  document.getElementById('boxCotizacionDetectada').classList.add('hidden');
  cotizacionDetectadaTmp = null;

  recalcularRendimientoModal();
  openModal('modalInversion');

  // Intentar traer cotización fresca de fondo
  consultarCotizacionManual(true);
}

function debounceConsultarCotizacion(ticker) {
  if (debounceTimerInversion) clearTimeout(debounceTimerInversion);
  if (!ticker || ticker.trim().length < 2) {
    document.getElementById('boxCotizacionDetectada').classList.add('hidden');
    return;
  }

  debounceTimerInversion = setTimeout(() => {
    consultarCotizacionManual(false);
  }, 500);
}

async function consultarCotizacionManual(silent = false) {
  const inputTicker = document.getElementById('inputInvTicker');
  const selectTipo = document.getElementById('inputInvTipo');
  const box = document.getElementById('boxCotizacionDetectada');
  const lbl = document.getElementById('lblPrecioMercadoDetectado');

  const ticker = inputTicker ? inputTicker.value.trim().toUpperCase() : '';
  const tipo = selectTipo ? selectTipo.value : 'CEDEAR';

  if (!ticker) {
    if (!silent) showToast('Ingresa un ticker o símbolo (ej: SPY, AAPL, BTC)', 'error');
    return;
  }

  try {
    const res = await authFetch(`${API_BASE}/inversiones/cotizacion/${ticker}?tipo=${tipo}`);
    if (!res.ok) {
      box.classList.add('hidden');
      if (!silent) showToast(`No se encontró cotización para ${ticker}`, 'error');
      return;
    }

    const data = await res.json();
    cotizacionDetectadaTmp = data.precioARS;

    if (lbl) lbl.textContent = formatMoney(data.precioARS);
    if (box) box.classList.remove('hidden');

    // Si el valor actual está vacío, auto-completarlo con el precio de mercado
    const inputValActual = document.getElementById('inputInvValorActual');
    if (inputValActual && (!inputValActual.value || parseFloat(inputValActual.value) === 0)) {
      inputValActual.value = data.precioARS;
      recalcularRendimientoModal();
    }

    if (!silent) showToast(`Cotización encontrada: ${formatMoney(data.precioARS)} (${data.fuente})`);
  } catch (err) {
    box.classList.add('hidden');
    if (!silent) console.error('Error buscando cotización:', err);
  }
}

function aplicarCotizacionAMercado() {
  if (cotizacionDetectadaTmp) {
    const inputValActual = document.getElementById('inputInvValorActual');
    if (inputValActual) {
      inputValActual.value = cotizacionDetectadaTmp;
      recalcularRendimientoModal();
      showToast('Precio de mercado aplicado');
    }
  }
}

function recalcularRendimientoModal() {
  const cant = parseFloat(document.getElementById('inputInvCantidad')?.value) || 0;
  const pCompra = parseFloat(document.getElementById('inputInvPrecioCompra')?.value) || 0;
  const vActual = parseFloat(document.getElementById('inputInvValorActual')?.value) || 0;

  const totalInvertido = cant * pCompra;
  const totalValuado = cant * (vActual > 0 ? vActual : pCompra);
  const ganancia = totalValuado - totalInvertido;
  const rindePct = totalInvertido > 0 ? ((ganancia / totalInvertido) * 100).toFixed(1) : 0;

  const lblInv = document.getElementById('lblTotalInvertidoModal');
  const lblVal = document.getElementById('lblTotalValuadoModal');
  const lblGan = document.getElementById('lblGananciaRindeModal');

  if (lblInv) lblInv.textContent = formatMoney(totalInvertido);
  if (lblVal) lblVal.textContent = formatMoney(totalValuado);
  if (lblGan) {
    const signo = ganancia >= 0 ? '+' : '';
    const color = ganancia >= 0 ? 'text-emerald-400' : 'text-rose-400';
    lblGan.textContent = `${signo}${formatMoney(ganancia)} (${signo}${rindePct}%)`;
    lblGan.className = `font-bold ${color}`;
  }
}

async function handleCrearInversion(event) {
  event.preventDefault();
  const form = event.target;
  const formData = new FormData(form);
  const invId = formData.get('id');

  const payload = {
    ticker: formData.get('ticker').trim().toUpperCase(),
    tipo: formData.get('tipo'),
    cantidad: parseFloat(formData.get('cantidad')),
    precio_promedio: parseFloat(formData.get('precio_promedio')) || 0,
    valor_actual: parseFloat(formData.get('valor_actual')) || 0
  };

  try {
    const isEdit = Boolean(invId);
    const url = isEdit ? `${API_BASE}/inversiones/${invId}` : `${API_BASE}/inversiones`;
    const method = isEdit ? 'PUT' : 'POST';

    const res = await authFetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) throw new Error(isEdit ? 'Error al actualizar inversión' : 'Error al registrar inversión');

    closeModal('modalInversion');
    form.reset();
    document.getElementById('inputInvId').value = '';
    showToast(isEdit ? `Posición ${payload.ticker} actualizada` : `Inversión ${payload.ticker} registrada`);
    await loadResumen();
    await loadInversiones();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function actualizarPreciosMercado() {
  const btn = document.getElementById('btnSyncMercado');
  try {
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<span class="animate-spin mr-1">⚙️</span> Consultando BYMA...`;
    }

    const res = await authFetch(`${API_BASE}/inversiones/actualizar-precios`, { method: 'POST' });
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || 'Error al actualizar cotizaciones');

    showToast(data.mensaje || 'Cotizaciones actualizadas con éxito');
    await loadResumen();
    await loadInversiones();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<i data-lucide="refresh-cw" class="w-3.5 h-3.5"></i><span>Actualizar Cotizaciones</span>`;
      if (window.lucide) lucide.createIcons();
    }
  }
}

async function handleCrearIngreso(event) {
  event.preventDefault();
  const form = event.target;
  const formData = new FormData(form);

  const payload = {
    fuente: formData.get('fuente'),
    monto: parseFloat(formData.get('monto')),
    mes: formData.get('mes')
  };

  try {
    const res = await authFetch(`${API_BASE}/ingresos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error('Error guardando ingreso');

    closeModal('modalIngreso');
    form.reset();
    showToast('Ingreso proyectado registrado');
    await loadResumen();
    await loadIngresos();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function abrirModalPago(id) {
  const gasto = (currentGastosList || []).find(g => g.id === id);
  if (!gasto) {
    showToast('No se encontró información del gasto', 'error');
    return;
  }

  currentGastoEnPago = gasto;
  const montoTotal = Number(gasto.monto) || 0;
  const montoPagadoActual = Number(gasto.monto_pagado) || 0;
  const montoRestante = Math.max(0, montoTotal - montoPagadoActual);
  const progresoPct = montoTotal > 0 ? Math.min(100, Math.round((montoPagadoActual / montoTotal) * 100)) : 0;

  // Llenar datos en el modal
  const elNombre = document.getElementById('pagoGastoNombre');
  const elId = document.getElementById('pagoGastoId');
  const elTotal = document.getElementById('pagoGastoMontoTotal');
  const elPagado = document.getElementById('pagoGastoMontoPagado');
  const elRestante = document.getElementById('pagoGastoMontoRestante');
  const elProgreso = document.getElementById('pagoGastoProgresoPct');
  const elBarra = document.getElementById('pagoGastoBarra');
  const inputMonto = document.getElementById('pagoMontoInput');

  if (elNombre) elNombre.textContent = `${gasto.nombre} (${gasto.categoria || 'Gasto'})`;
  if (elId) elId.value = gasto.id;
  if (elTotal) elTotal.textContent = formatMoney(montoTotal);
  if (elPagado) elPagado.textContent = formatMoney(montoPagadoActual);
  if (elRestante) elRestante.textContent = formatMoney(montoRestante);
  if (elProgreso) elProgreso.textContent = `${progresoPct}%`;
  if (elBarra) elBarra.style.width = `${progresoPct}%`;

  // Por defecto sugerir liquidar el monto restante
  if (inputMonto) {
    inputMonto.value = montoRestante > 0 ? montoRestante : montoTotal;
    inputMonto.max = montoRestante > 0 ? montoRestante : montoTotal;
  }

  // Cargar cuentas bancarias disponibles en el select
  await poblarCuentasSelectPago();

  openModal('modalPagoGasto');
  if (inputMonto) {
    setTimeout(() => {
      inputMonto.focus();
      inputMonto.select();
    }, 100);
  }
}

async function poblarCuentasSelectPago() {
  const select = document.getElementById('pagoGastoCuentaSelect');
  if (!select) return;

  select.innerHTML = '<option value="">No descontar de ninguna cuenta</option>';
  try {
    const res = await authFetch(`${API_BASE}/cuentas`);
    if (!res.ok) return;
    const cuentas = await res.json();
    cuentas.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = `${c.nombre} (Saldo: ${formatMoney(c.saldo)})`;
      select.appendChild(opt);
    });
  } catch (err) {
    console.error('Error poblando cuentas para pago:', err);
  }
}

function setMontoPagoPorcentaje(pct) {
  if (!currentGastoEnPago) return;
  const montoTotal = Number(currentGastoEnPago.monto) || 0;
  const montoPagadoActual = Number(currentGastoEnPago.monto_pagado) || 0;
  const montoRestante = Math.max(0, montoTotal - montoPagadoActual);

  const baseCalculo = montoRestante > 0 ? montoRestante : montoTotal;
  const montoCalculado = Math.round(baseCalculo * pct * 100) / 100;

  const inputMonto = document.getElementById('pagoMontoInput');
  if (inputMonto) {
    inputMonto.value = montoCalculado;
    inputMonto.focus();
  }
}

function setMontoPagoTotal() {
  if (!currentGastoEnPago) return;
  const montoTotal = Number(currentGastoEnPago.monto) || 0;
  const montoPagadoActual = Number(currentGastoEnPago.monto_pagado) || 0;
  const montoRestante = Math.max(0, montoTotal - montoPagadoActual);

  const inputMonto = document.getElementById('pagoMontoInput');
  if (inputMonto) {
    inputMonto.value = montoRestante > 0 ? montoRestante : montoTotal;
    inputMonto.focus();
  }
}

async function handleConfirmarPagoGasto(event) {
  event.preventDefault();
  if (!currentGastoEnPago) return;

  const inputMonto = document.getElementById('pagoMontoInput');
  const selectCuenta = document.getElementById('pagoGastoCuentaSelect');
  const btnSubmit = document.getElementById('btnConfirmarPagoGasto');

  const abono = parseFloat(inputMonto.value);
  if (isNaN(abono) || abono <= 0) {
    showToast('Por favor, ingresa un monto válido mayor a 0', 'error');
    return;
  }

  const montoTotal = Number(currentGastoEnPago.monto) || 0;
  const yaPagado = Number(currentGastoEnPago.monto_pagado) || 0;
  const nuevoTotalPagado = yaPagado + abono;
  const cuentaId = selectCuenta ? selectCuenta.value : null;

  try {
    if (btnSubmit) {
      btnSubmit.disabled = true;
      btnSubmit.innerHTML = `<span class="animate-spin mr-1.5">⚙️</span> Procesando...`;
    }

    const res = await authFetch(`${API_BASE}/gastos/${currentGastoEnPago.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        monto_pagado: nuevoTotalPagado,
        cuenta_id: cuentaId ? parseInt(cuentaId, 10) : null,
        monto_abonado: abono
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al procesar el pago');

    closeModal('modalPagoGasto');

    if (data.estado === 'pagado') {
      showToast(`¡Deuda liquidada al 100%! (${formatMoney(abono)} abonados)`);
    } else {
      const rest = Math.max(0, data.monto - data.monto_pagado);
      showToast(`Pago parcial de ${formatMoney(abono)} registrado. Restan: ${formatMoney(rest)}`);
    }

    await loadAllData();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    if (btnSubmit) {
      btnSubmit.disabled = false;
      btnSubmit.innerHTML = `<i data-lucide="check" class="w-4 h-4 stroke-[2.5]"></i><span>Confirmar Pago</span>`;
      if (window.lucide) lucide.createIcons();
    }
  }
}

async function marcarGastoPagado(id, monto) {
  // Ahora marcar pago abre el modal interactivo
  abrirModalPago(id);
}

async function eliminarGasto(id) {
  if (!confirm('¿Eliminar este gasto?')) return;
  try {
    const res = await authFetch(`${API_BASE}/gastos/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Error al eliminar');
    showToast('Gasto eliminado');
    await loadResumen();
    await loadGastos();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function editarSaldoCuenta(id, saldoActual) {
  // Redirigir al nuevo modal moderno de edición
  abrirModalEditarCuenta(id);
}

// ==========================================
// TRANSFERENCIA ENTRE CUENTAS PROPIAS
// ==========================================

async function abrirModalTransferencia() {
  const form = document.getElementById('formTransferencia');
  if (form) form.reset();

  const selOrigen = document.getElementById('transferenciaCuentaOrigen');
  const selDestino = document.getElementById('transferenciaCuentaDestino');
  const montoInput = document.getElementById('transferenciaMonto');

  if (montoInput) montoInput.value = '';

  try {
    const res = await authFetch(`${API_BASE}/cuentas`);
    if (!res.ok) return;
    const cuentas = await res.json();
    currentCuentasList = cuentas;

    if (!cuentas || cuentas.length < 2) {
      showToast('Necesitas al menos 2 cuentas para transferir fondos entre ellas', 'error');
      return;
    }

    if (selOrigen) {
      selOrigen.innerHTML = '<option value="">Selecciona cuenta de origen</option>' + 
        cuentas.map(c => `<option value="${c.id}">${c.nombre} (Saldo: ${formatMoney(c.saldo)})</option>`).join('');
    }

    if (selDestino) {
      selDestino.innerHTML = '<option value="">Selecciona cuenta de destino</option>' + 
        cuentas.map(c => `<option value="${c.id}">${c.nombre} (Saldo: ${formatMoney(c.saldo)})</option>`).join('');
    }

    if (cuentas.length >= 2) {
      selOrigen.value = cuentas[0].id;
      selDestino.value = cuentas[1].id;
    }

    actualizarPreviewTransferencia();
    openModal('modalTransferencia');
    if (window.lucide) lucide.createIcons();
    setTimeout(() => {
      if (montoInput) montoInput.focus();
    }, 100);
  } catch (err) {
    console.error('Error abriendo modal de transferencia:', err);
  }
}

function setMontoTransferenciaPct(pct) {
  const selOrigen = document.getElementById('transferenciaCuentaOrigen');
  const montoInput = document.getElementById('transferenciaMonto');
  if (!selOrigen || !montoInput || !selOrigen.value) return;

  const cuentaOrigen = currentCuentasList?.find(c => c.id === parseInt(selOrigen.value, 10));
  if (!cuentaOrigen) return;

  const saldo = Number(cuentaOrigen.saldo) || 0;
  const monto = Math.round(saldo * pct * 100) / 100;
  montoInput.value = monto > 0 ? monto : '';
  actualizarPreviewTransferencia();
}

function setMontoTransferenciaFijo(monto) {
  const montoInput = document.getElementById('transferenciaMonto');
  if (montoInput) {
    montoInput.value = monto;
    actualizarPreviewTransferencia();
  }
}

function actualizarPreviewTransferencia() {
  const selOrigen = document.getElementById('transferenciaCuentaOrigen');
  const selDestino = document.getElementById('transferenciaCuentaDestino');
  const montoInput = document.getElementById('transferenciaMonto');
  const lblSaldoOrigen = document.getElementById('lblSaldoOrigenDisponible');
  const lblSaldoDestino = document.getElementById('lblSaldoDestinoDisponible');

  const origenId = selOrigen ? parseInt(selOrigen.value, 10) : null;
  const destinoId = selDestino ? parseInt(selDestino.value, 10) : null;
  const monto = parseFloat(montoInput?.value) || 0;

  const cOrigen = currentCuentasList?.find(c => c.id === origenId);
  const cDestino = currentCuentasList?.find(c => c.id === destinoId);

  if (lblSaldoOrigen) lblSaldoOrigen.textContent = cOrigen ? `Saldo: ${formatMoney(cOrigen.saldo)}` : '';
  if (lblSaldoDestino) lblSaldoDestino.textContent = cDestino ? `Saldo: ${formatMoney(cDestino.saldo)}` : '';

  const prevOriNombre = document.getElementById('previewOrigenNombre');
  const prevOriAct = document.getElementById('previewOrigenActual');
  const prevOriNue = document.getElementById('previewOrigenNuevo');

  const prevDesNombre = document.getElementById('previewDestinoNombre');
  const prevDesAct = document.getElementById('previewDestinoActual');
  const prevDesNue = document.getElementById('previewDestinoNuevo');

  if (cOrigen) {
    if (prevOriNombre) prevOriNombre.textContent = cOrigen.nombre;
    if (prevOriAct) prevOriAct.textContent = formatMoney(cOrigen.saldo);
    const nuevoSaldoOrigen = cOrigen.saldo - monto;
    if (prevOriNue) {
      prevOriNue.textContent = formatMoney(nuevoSaldoOrigen);
      prevOriNue.className = nuevoSaldoOrigen < 0 ? 'font-bold text-rose-500' : 'font-bold text-rose-400';
    }
  } else {
    if (prevOriNombre) prevOriNombre.textContent = 'Origen';
    if (prevOriAct) prevOriAct.textContent = '$ 0';
    if (prevOriNue) prevOriNue.textContent = '$ 0';
  }

  if (cDestino) {
    if (prevDesNombre) prevDesNombre.textContent = cDestino.nombre;
    if (prevDesAct) prevDesAct.textContent = formatMoney(cDestino.saldo);
    const nuevoSaldoDestino = cDestino.saldo + monto;
    if (prevDesNue) prevDesNue.textContent = formatMoney(nuevoSaldoDestino);
  } else {
    if (prevDesNombre) prevDesNombre.textContent = 'Destino';
    if (prevDesAct) prevDesAct.textContent = '$ 0';
    if (prevDesNue) prevDesNue.textContent = '$ 0';
  }
}

async function handleTransferirCuentas(event) {
  event.preventDefault();
  const selOrigen = document.getElementById('transferenciaCuentaOrigen');
  const selDestino = document.getElementById('transferenciaCuentaDestino');
  const montoInput = document.getElementById('transferenciaMonto');
  const btn = document.getElementById('btnConfirmarTransferencia');

  const origenId = parseInt(selOrigen?.value, 10);
  const destinoId = parseInt(selDestino?.value, 10);
  const monto = parseFloat(montoInput?.value);

  if (!origenId || !destinoId) {
    showToast('Debes seleccionar cuenta de origen y destino', 'error');
    return;
  }
  if (origenId === destinoId) {
    showToast('La cuenta de origen y destino no pueden ser la misma', 'error');
    return;
  }
  if (isNaN(monto) || monto <= 0) {
    showToast('Ingresa un monto válido mayor a 0', 'error');
    return;
  }

  const cOrigen = currentCuentasList?.find(c => c.id === origenId);
  if (cOrigen && cOrigen.saldo < monto) {
    showToast(`Saldo insuficiente en ${cOrigen.nombre}. Tienes ${formatMoney(cOrigen.saldo)}`, 'error');
    return;
  }

  try {
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<span class="animate-spin mr-1.5">⚙️</span> Procesando...`;
    }

    const res = await authFetch(`${API_BASE}/cuentas/transferir`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cuenta_origen_id: origenId,
        cuenta_destino_id: destinoId,
        monto
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al procesar la transferencia');

    closeModal('modalTransferencia');
    showToast(data.message || 'Transferencia realizada con éxito');
    await loadAllData();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<i data-lucide="check" class="w-4 h-4"></i><span>Confirmar Transferencia</span>`;
      if (window.lucide) lucide.createIcons();
    }
  }
}

async function eliminarCuenta(id) {
  if (!confirm('¿Eliminar esta cuenta bancaria?')) return;
  try {
    const res = await authFetch(`${API_BASE}/cuentas/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Error al eliminar');
    showToast('Cuenta eliminada');
    await loadResumen();
    await loadCuentas();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function eliminarInversion(id) {
  if (!confirm('¿Eliminar esta posición de inversión?')) return;
  try {
    const res = await authFetch(`${API_BASE}/inversiones/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Error al eliminar');
    showToast('Inversión eliminada');
    await loadResumen();
    await loadInversiones();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function marcarIngresoCobrado(id) {
  try {
    const res = await authFetch(`${API_BASE}/ingresos/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ estado: 'cobrado' })
    });
    if (!res.ok) throw new Error('Error al marcar cobrado');
    showToast('Ingreso marcado como cobrado');
    await loadResumen();
    await loadIngresos();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function eliminarIngreso(id) {
  if (!confirm('¿Eliminar este ingreso proyectado?')) return;
  try {
    const res = await authFetch(`${API_BASE}/ingresos/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Error al eliminar');
    showToast('Ingreso eliminado');
    await loadResumen();
    await loadIngresos();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ==========================================
// 5. EDUCACIÓN FINANCIERA & DIAGNÓSTICO EN VIVO
// ==========================================

async function loadDiagnosticoEducativo() {
  if (!authToken) return;
  try {
    const res = await authFetch(`${API_BASE}/educacion/diagnostico`);
    if (!res.ok) throw new Error('Error al cargar diagnóstico educativo');
    const data = await res.json();

    // 0. SCORE GLOBAL DE SALUD FINANCIERA (0 - 100)
    if (data.scoreSalud) {
      const s = data.scoreSalud;
      const totalEl = document.getElementById('eduScoreTotal');
      const badgeEl = document.getElementById('eduScoreBadge');
      const nivelEl = document.getElementById('eduScoreNivel');
      const descEl = document.getElementById('eduScoreDesc');
      const ringEl = document.getElementById('scoreRingProgress');

      if (totalEl) totalEl.textContent = s.total;
      if (nivelEl) {
        nivelEl.textContent = s.label;
        const colorClasses = {
          emerald: 'text-emerald-400',
          blue: 'text-blue-400',
          amber: 'text-amber-400',
          rose: 'text-rose-400'
        };
        nivelEl.className = `text-sm font-bold ${colorClasses[s.color] || 'text-white'} mb-0.5`;
      }
      if (descEl) {
        descEl.textContent = s.total >= 85 
          ? '¡Estructura financiera blindada con excelente capacidad de ahorro e inversión!'
          : s.total >= 65 
          ? 'Finanzas saludables y estables. Puedes optimizar tu fondo o acelerar inversiones.'
          : s.total >= 45 
          ? 'Nivel moderado. Conviene controlar gastos no esenciales y acelerar pago de deudas.'
          : 'Nivel vulnerable. Prioriza liquidar deudas de consumo y armar tu fondo de emergencia.';
      }
      if (badgeEl) {
        const badgeColors = {
          emerald: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
          blue: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
          amber: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
          rose: 'bg-rose-500/10 text-rose-400 border-rose-500/20'
        };
        badgeEl.className = `text-[10px] font-bold px-2.5 py-0.5 rounded-full border ${badgeColors[s.color] || ''}`;
        badgeEl.textContent = `${s.nivel} (${s.total}/100)`;
      }
      if (ringEl) {
        const circ = 314.159;
        const offset = circ - (s.total / 100) * circ;
        ringEl.style.strokeDashoffset = offset;
        const ringColors = {
          emerald: 'text-emerald-400',
          blue: 'text-blue-400',
          amber: 'text-amber-400',
          rose: 'text-rose-400'
        };
        ringEl.setAttribute('class', `${ringColors[s.color] || 'text-emerald-400'} transition-all duration-1000 ease-out`);
      }

      // Los 4 pilares
      const pil = s.pilares;
      const pAhorro = document.getElementById('pilarAhorroPuntos');
      const bAhorro = document.getElementById('pilarAhorroBar');
      const stAhorro = document.getElementById('pilarAhorroStatus');
      if (pAhorro) pAhorro.textContent = `${pil.ahorro.puntos} / ${pil.ahorro.max} pts`;
      if (bAhorro) bAhorro.style.width = `${pil.ahorro.pct}%`;
      if (stAhorro) stAhorro.textContent = `${data.regla503020.ahorro.pct}% de ahorro`;

      const pFondo = document.getElementById('pilarFondoPuntos');
      const bFondo = document.getElementById('pilarFondoBar');
      const stFondo = document.getElementById('pilarFondoStatus');
      if (pFondo) pFondo.textContent = `${pil.fondo.puntos} / ${pil.fondo.max} pts`;
      if (bFondo) bFondo.style.width = `${pil.fondo.pct}%`;
      if (stFondo) stFondo.textContent = `${data.fondoEmergencia.mesesCubiertos} meses cubiertos`;

      const pDeuda = document.getElementById('pilarDeudaPuntos');
      const bDeuda = document.getElementById('pilarDeudaBar');
      const stDeuda = document.getElementById('pilarDeudaStatus');
      if (pDeuda) pDeuda.textContent = `${pil.deuda.puntos} / ${pil.deuda.max} pts`;
      if (bDeuda) bDeuda.style.width = `${pil.deuda.pct}%`;
      if (stDeuda) stDeuda.textContent = data.metodosDeuda.totalDeudaPendiente === 0 ? 'Sin pasivos pendientes' : `${formatMoney(data.metodosDeuda.totalDeudaPendiente)} en deuda`;

      const pInv = document.getElementById('pilarInversionPuntos');
      const bInv = document.getElementById('pilarInversionBar');
      const stInv = document.getElementById('pilarInversionStatus');
      if (pInv) pInv.textContent = `${pil.inversion.puntos} / ${pil.inversion.max} pts`;
      if (bInv) bInv.style.width = `${pil.inversion.pct}%`;
      if (stInv) stInv.textContent = (data.totalInversiones && data.totalInversiones > 0) ? `${formatMoney(data.totalInversiones)} invertidos` : 'Sin inversiones activas';

      // Tips recomendados para subir score
      const tipsContainer = document.getElementById('eduScoreTips');
      if (tipsContainer) {
        if (s.tips && s.tips.length > 0) {
          tipsContainer.innerHTML = s.tips.map(t => `
            <div class="p-3 rounded-xl bg-slate-950/70 border border-slate-800/90 flex items-start gap-2.5">
              <div class="w-7 h-7 rounded-lg bg-amber-400/10 text-amber-300 flex items-center justify-center shrink-0 mt-0.5">
                <i data-lucide="${t.icono || 'sparkles'}" class="w-3.5 h-3.5"></i>
              </div>
              <div class="space-y-1">
                <p class="text-xs text-slate-300 leading-snug">${t.texto}</p>
                <span class="inline-block text-[10px] font-bold text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">+${t.puntosExtra} pts</span>
              </div>
            </div>
          `).join('');
        } else {
          tipsContainer.innerHTML = `
            <div class="col-span-3 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-center text-xs text-emerald-300">
              🎉 ¡Felicitaciones! Has optimizado todos los pilares principales de tu salud financiera.
            </div>
          `;
        }
      }
    }

    // 1. REGLA 50 / 30 / 20
    const r = data.regla503020;
    const baseEl = document.getElementById('edu503020Base');
    if (baseEl) baseEl.textContent = formatMoney(r.baseCalculo);

    const necPctEl = document.getElementById('eduNecPct');
    const necMontoEl = document.getElementById('eduNecMonto');
    const barNec = document.getElementById('barEduNecesidades');
    if (necPctEl) necPctEl.textContent = `${r.necesidades.pct}%`;
    if (necMontoEl) necMontoEl.textContent = formatMoney(r.necesidades.monto);
    if (barNec) barNec.style.width = `${Math.min(100, r.necesidades.pct)}%`;

    const desPctEl = document.getElementById('eduDesPct');
    const desMontoEl = document.getElementById('eduDesMonto');
    const barDes = document.getElementById('barEduDeseos');
    if (desPctEl) desPctEl.textContent = `${r.deseos.pct}%`;
    if (desMontoEl) desMontoEl.textContent = formatMoney(r.deseos.monto);
    if (barDes) barDes.style.width = `${Math.min(100, r.deseos.pct)}%`;

    const ahoPctEl = document.getElementById('eduAhoPct');
    const ahoMontoEl = document.getElementById('eduAhoMonto');
    const barAho = document.getElementById('barEduAhorro');
    if (ahoPctEl) ahoPctEl.textContent = `${r.ahorro.pct}%`;
    if (ahoMontoEl) ahoMontoEl.textContent = formatMoney(r.ahorro.monto);
    if (barAho) barAho.style.width = `${Math.min(100, r.ahorro.pct)}%`;

    const badge503020 = document.getElementById('edu503020Badge');
    const tip503020 = document.getElementById('edu503020Tip');
    if (badge503020) {
      if (r.estado === 'saludable') {
        badge503020.className = 'text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20';
        badge503020.textContent = 'Saludable ✓';
      } else if (r.estado === 'ajustado') {
        badge503020.className = 'text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/20';
        badge503020.textContent = 'Sobrecarga Fija';
      } else {
        badge503020.className = 'text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20';
        badge503020.textContent = 'Atención';
      }
    }

    if (tip503020) {
      if (r.deseos.pct > 35) {
        tip503020.innerHTML = `<i data-lucide="alert-triangle" class="w-4 h-4 text-amber-400 shrink-0 mt-0.5"></i><span>Tus <strong>Deseos y Créditos (${r.deseos.pct}%)</strong> superan el 30% sugerido. Considera frenar consumos en cuotas para liberar liquidez.</span>`;
      } else if (r.necesidades.pct > 60) {
        tip503020.innerHTML = `<i data-lucide="alert-circle" class="w-4 h-4 text-rose-400 shrink-0 mt-0.5"></i><span>Tus <strong>Gastos Fijos (${r.necesidades.pct}%)</strong> están altos. Revisa servicios o tarifas antes de asumir nuevos compromisos.</span>`;
      } else {
        tip503020.innerHTML = `<i data-lucide="check-circle" class="w-4 h-4 text-emerald-400 shrink-0 mt-0.5"></i><span>¡Excelente equilibrio! Tus necesidades están controladas y dejas espacio para resguardo e inversiones.</span>`;
      }
    }

    // 2. FONDO DE EMERGENCIA
    const fe = data.fondoEmergencia;
    const mesesEl = document.getElementById('eduFondoMesesCubiertos');
    const costoEl = document.getElementById('eduFondoCostoFijo');
    const liquidezEl = document.getElementById('eduFondoLiquidez');
    const meta3El = document.getElementById('eduFondoMeta3');
    const barFondo = document.getElementById('barEduFondo');
    const badgeFondo = document.getElementById('eduFondoNivelBadge');
    const consejoFondo = document.getElementById('eduFondoConsejo');

    if (mesesEl) mesesEl.textContent = fe.mesesCubiertos;
    if (costoEl) costoEl.textContent = formatMoney(fe.costoVidaMensual);
    if (liquidezEl) liquidezEl.textContent = formatMoney(fe.saldoLiquidoActual);
    if (meta3El) meta3El.textContent = formatMoney(fe.meta3Meses);
    if (barFondo) barFondo.style.width = `${Math.min(100, Math.max(5, fe.progreso3MesesPct))}%`;

    if (badgeFondo) {
      const colorMap = {
        'Excelente': 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
        'Aceptable': 'bg-blue-500/10 text-blue-400 border-blue-500/20',
        'Vulnerable': 'bg-amber-500/10 text-amber-400 border-amber-500/20',
        'Crítico': 'bg-rose-500/10 text-rose-400 border-rose-500/20'
      };
      badgeFondo.className = `text-[10px] font-bold px-2 py-0.5 rounded-full border ${colorMap[fe.nivel] || ''}`;
      badgeFondo.textContent = `${fe.nivel} (${fe.mesesCubiertos}m)`;
    }

    if (consejoFondo) {
      if (fe.mesesCubiertos < 1) {
        consejoFondo.innerHTML = `<i data-lucide="shield-alert" class="w-4 h-4 text-rose-400 shrink-0 mt-0.5"></i><span><strong>Alerta:</strong> Tu colchón de seguridad cubre menos de 1 mes (${fe.mesesCubiertos} meses). Prioriza fondos Money Market antes de invertir en bolsa o criptos.</span>`;
      } else if (fe.mesesCubiertos < 3) {
        consejoFondo.innerHTML = `<i data-lucide="shield" class="w-4 h-4 text-amber-400 shrink-0 mt-0.5"></i><span>Estás en camino (${fe.mesesCubiertos} meses). Para llegar a la meta básica de 3 meses te faltan <strong>${formatMoney(Math.max(0, fe.meta3Meses - fe.saldoLiquidoActual))}</strong>.</span>`;
      } else {
        consejoFondo.innerHTML = `<i data-lucide="shield-check" class="w-4 h-4 text-emerald-400 shrink-0 mt-0.5"></i><span><strong>¡Gran cobertura!</strong> Tienes ${fe.mesesCubiertos} meses de vida cubiertos. El excedente por encima de 6 meses ya puede rentabilizarse a mayor plazo (CEDEARs, ONs).</span>`;
      }
    }

    // 3. MÉTODOS DE DEUDA: SELECTOR MULTI-ESTRATEGIA
    const md = data.metodosDeuda;
    const totalDeudaEl = document.getElementById('eduTotalDeuda');
    if (totalDeudaEl) totalDeudaEl.textContent = formatMoney(md.totalDeudaPendiente);

    catalogoEstrategiasDeuda = md.estrategias || null;
    actualizarVistaEstrategiaDeuda(currentEstrategiaDeuda);

    // 4. CONFIGURAR SIMULADOR INTERACTIVO
    window._eduDataSimulador = {
      deudas: md.todasDeudas || [],
      totalDeuda: md.totalDeudaPendiente || 0,
      ingreso: r.ingresosMes || 0
    };

    // Correr simulador inicial con el valor actual del slider
    const currentSliderVal = Number(document.getElementById('simuladorSlider')?.value || 0);
    ejecutarSimuladorDeuda(currentSliderVal);

    if (window.lucide) lucide.createIcons();
  } catch (err) {
    console.error('Error cargando diagnóstico educativo:', err);
  }
}

// ==========================================
// SELECTOR DE ESTRATEGIAS DE DESENDEUDAMIENTO
// ==========================================

function seleccionarEstrategiaDeuda(clave) {
  if (!clave) return;
  currentEstrategiaDeuda = clave;
  actualizarVistaEstrategiaDeuda(clave);

  // Recalcular simulador en tiempo real con la estrategia elegida
  const slider = document.getElementById('simuladorSlider');
  const aporte = Number(slider ? slider.value : 0) || 0;
  ejecutarSimuladorDeuda(aporte);
}

function actualizarVistaEstrategiaDeuda(clave) {
  const cat = catalogoEstrategiasDeuda;
  if (!cat || !cat[clave]) return;
  const strat = cat[clave];

  // 1. Estilos visuales de las 4 pestañas / botones
  const estilosTabs = [
    { id: 'bolaDeNieve', active: 'bg-blue-500/15 border-blue-500/40 text-white shadow-sm' },
    { id: 'avalancha', active: 'bg-rose-500/15 border-rose-500/40 text-white shadow-sm' },
    { id: 'flujoCaja', active: 'bg-emerald-500/15 border-emerald-500/40 text-white shadow-sm' },
    { id: 'tsunami', active: 'bg-purple-500/15 border-purple-500/40 text-white shadow-sm' }
  ];

  estilosTabs.forEach(item => {
    const btn = document.getElementById(`stratBtn-${item.id}`);
    if (!btn) return;
    if (item.id === clave) {
      btn.className = `strat-tab-btn p-3 rounded-xl border text-left transition flex flex-col justify-between gap-2 ${item.active}`;
    } else {
      btn.className = 'strat-tab-btn p-3 rounded-xl border text-left transition flex flex-col justify-between gap-2 bg-slate-950/60 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700';
    }
  });

  // 2. Información pedagógica de la estrategia
  const iconoEl = document.getElementById('stratIcono');
  const tituloEl = document.getElementById('stratTitulo');
  const subtituloEl = document.getElementById('stratSubtitulo');
  const badgeEl = document.getElementById('stratBadge');
  const descEl = document.getElementById('stratDescripcion');
  const idealEl = document.getElementById('stratIdealPara');

  if (iconoEl) iconoEl.textContent = strat.icono;
  if (tituloEl) tituloEl.textContent = `Método ${strat.nombre}`;
  if (subtituloEl) subtituloEl.textContent = strat.subtitulo || `Enfoque ${strat.enfoque}`;
  if (badgeEl) {
    badgeEl.textContent = strat.enfoque;
    badgeEl.className = `text-[10px] px-2.5 py-0.5 rounded-full font-bold border ${strat.colorBadge || 'bg-blue-500/10 text-blue-400 border-blue-500/20'}`;
  }
  if (descEl) descEl.innerHTML = strat.descripcion;
  if (idealEl) idealEl.textContent = `Ideal para: ${strat.idealPara}`;

  // 3. Blanco u Objetivo Inmediato Sugerido
  const targetHeaderEl = document.getElementById('stratTargetHeader');
  const targetBadgeEl = document.getElementById('stratTargetBadge');
  const targetTextoEl = document.getElementById('stratTargetTexto');

  if (targetHeaderEl) targetHeaderEl.textContent = `Próximo Objetivo (${strat.nombre}):`;
  if (targetBadgeEl) targetBadgeEl.textContent = 'Prioridad #1';

  if (targetTextoEl) {
    if (strat.proximoObjetivo) {
      const obj = strat.proximoObjetivo;
      if (clave === 'bolaDeNieve') {
        targetTextoEl.innerHTML = `Liquidar <strong>${obj.nombre}</strong> con saldo de <strong>${formatMoney(obj.resto_deuda)}</strong> (${obj.categoria || 'Gasto'}). ¡Victoria rápida asegurada!`;
      } else if (clave === 'avalancha') {
        targetTextoEl.innerHTML = `Atacar <strong>${obj.nombre}</strong> con saldo de <strong>${formatMoney(obj.resto_deuda)}</strong> (Prioridad: ${obj.prioridad || 'Alta'}, Vto: ${obj.vencimiento || 'Próximo'}). Corta los intereses más altos.`;
      } else if (clave === 'flujoCaja') {
        const cuota = obj.cuotaEstimada || Math.max(Math.round(obj.resto_deuda * 0.10), Math.min(obj.resto_deuda, 30000));
        targetTextoEl.innerHTML = `Cancelar <strong>${obj.nombre}</strong> (${formatMoney(obj.resto_deuda)}). Libera aprox. <strong>${formatMoney(cuota)}/mes</strong> directo a tu bolsillo.`;
      } else if (clave === 'tsunami') {
        targetTextoEl.innerHTML = `Asegurar <strong>${obj.nombre}</strong> (${formatMoney(obj.resto_deuda)} - ${obj.categoria || 'Servicio'}). Protege suministros y bienestar del hogar.`;
      } else {
        targetTextoEl.innerHTML = `Liquidar <strong>${obj.nombre}</strong> (${formatMoney(obj.resto_deuda)}).`;
      }
    } else {
      targetTextoEl.innerHTML = `<span class="text-emerald-400 font-semibold">🎉 ¡Sin deudas pendientes! Cuentas totalmente al día.</span>`;
    }
  }

  // 4. Lista Ordenada Top 5 de la Estrategia Activa
  const listaEl = document.getElementById('stratOrdenLista');
  if (listaEl) {
    const orden = strat.orden || [];
    if (orden.length === 0) {
      listaEl.innerHTML = `<div class="text-slate-500 py-3 text-center text-xs">No hay deudas activas registradas.</div>`;
    } else {
      const top5 = orden.slice(0, 5);
      listaEl.innerHTML = top5.map((d, idx) => {
        let detalleSub = '';
        if (clave === 'avalancha') {
          detalleSub = `Vto: ${d.vencimiento || 'S/F'} • Prioridad: ${d.prioridad || 'Normal'}`;
        } else if (clave === 'flujoCaja') {
          const cuota = d.cuotaEstimada || Math.max(Math.round(d.resto_deuda * 0.10), Math.min(d.resto_deuda, 30000));
          detalleSub = `Libera ${formatMoney(cuota)}/mes • CFI: ${d.cfi || (d.resto_deuda / (cuota || 1)).toFixed(1)}`;
        } else if (clave === 'tsunami') {
          detalleSub = `Cat: ${d.categoria || 'Gasto'} • Urgencia: ${d.prioridad || 'Normal'}`;
        } else {
          detalleSub = `${d.categoria || 'Pasivo'} • Menor saldo`;
        }

        const esPrimero = idx === 0;
        return `
          <div class="flex items-center justify-between p-2 rounded-lg ${esPrimero ? 'bg-slate-900 border-indigo-500/40' : 'bg-slate-950 border-slate-800/80'} border transition hover:border-slate-700">
            <div class="flex items-center gap-2 overflow-hidden">
              <span class="w-5 h-5 rounded-full ${esPrimero ? 'bg-indigo-500/20 text-indigo-300 font-bold' : 'bg-slate-800 text-slate-400'} flex items-center justify-center text-[10px] shrink-0">
                #${idx + 1}
              </span>
              <div class="truncate">
                <div class="font-medium text-slate-200 truncate text-xs ${esPrimero ? 'text-white font-semibold' : ''}">${d.nombre}</div>
                <div class="text-[10px] text-slate-400 truncate">${detalleSub}</div>
              </div>
            </div>
            <div class="text-right shrink-0 ml-2">
              <span class="font-bold text-xs ${esPrimero ? 'text-rose-400' : 'text-slate-300'}">${formatMoney(d.resto_deuda)}</span>
            </div>
          </div>
        `;
      }).join('');
    }
  }

  // 5. Encabezado del simulador
  const simNombreEl = document.getElementById('simuladorEstrategiaNombre');
  if (simNombreEl) {
    simNombreEl.textContent = strat.nombre;
  }
}

// ==========================================
// SIMULADOR INTERACTIVO ACELERADOR DE DEUDAS
// ==========================================

function onSimuladorSliderChange(val) {
  const aporte = Number(val) || 0;
  const disp = document.getElementById('simuladorAporteDisplay');
  if (disp) disp.textContent = formatMoney(aporte);
  ejecutarSimuladorDeuda(aporte);
}

function setSimuladorAporte(monto) {
  const slider = document.getElementById('simuladorSlider');
  const disp = document.getElementById('simuladorAporteDisplay');
  if (slider) slider.value = monto;
  if (disp) disp.textContent = formatMoney(monto);
  ejecutarSimuladorDeuda(monto);
}

function simularAmortizacionBolaNieve(deudasArray, aporteExtra, estrategiaKey = currentEstrategiaDeuda) {
  if (!deudasArray || deudasArray.length === 0) {
    return { totalMeses: 0, debts: [] };
  }

  // Clonar y mapear deudas con su cuota base mensual
  const debts = deudasArray.map(d => {
    const resto = Number(d.resto_deuda !== undefined ? d.resto_deuda : (d.saldo !== undefined ? d.saldo : d.monto)) || 0;
    // Cuota base mensual realista: 10% del saldo o $30.000 como mínimo
    const pagoBase = Math.max(Math.round(resto * 0.10), Math.min(resto, 30000));
    return {
      id: d.id,
      nombre: d.nombre,
      categoria: d.categoria || 'credito',
      prioridad: d.prioridad || 'media',
      vencimiento: d.vencimiento || '9999',
      saldo: resto,
      saldoInicial: resto,
      pagoBase: pagoBase,
      mesEliminada: null
    };
  });

  // Ordenar deudas de acuerdo a la estrategia activa elegida por el usuario
  if (estrategiaKey === 'avalancha') {
    const prioMap = { alta: 3, media: 2, baja: 1 };
    debts.sort((a, b) => {
      const pDiff = (prioMap[b.prioridad] || 1) - (prioMap[a.prioridad] || 1);
      if (pDiff !== 0) return pDiff;
      if (a.vencimiento && b.vencimiento) {
        const vDiff = a.vencimiento.localeCompare(b.vencimiento);
        if (vDiff !== 0) return vDiff;
      }
      return a.saldo - b.saldo;
    });
  } else if (estrategiaKey === 'flujoCaja') {
    // Menor Cashflow Index (saldo / cuota base) se liquida antes
    debts.sort((a, b) => {
      const cfiA = a.saldo / (a.pagoBase || 1);
      const cfiB = b.saldo / (b.pagoBase || 1);
      if (cfiA !== cfiB) return cfiA - cfiB;
      return a.saldo - b.saldo;
    });
  } else if (estrategiaKey === 'tsunami') {
    // Servicios fijos e impuestos primero
    const catScore = { operativo: 3, impuesto: 2, credito: 1 };
    const prioMap = { alta: 3, media: 2, baja: 1 };
    debts.sort((a, b) => {
      const cDiff = (catScore[b.categoria] || 1) - (catScore[a.categoria] || 1);
      if (cDiff !== 0) return cDiff;
      const pDiff = (prioMap[b.prioridad] || 1) - (prioMap[a.prioridad] || 1);
      if (pDiff !== 0) return pDiff;
      return a.saldo - b.saldo;
    });
  } else {
    // Por defecto: Bola de Nieve (menor saldo total primero)
    debts.sort((a, b) => a.saldo - b.saldo);
  }

  let mes = 0;
  const maxMeses = 120; // Límite de seguridad: 10 años
  let flujoLiberadoAcumulado = 0;

  while (debts.some(d => d.saldo > 0) && mes < maxMeses) {
    mes++;
    let extraDisponibleEsteMes = aporteExtra + flujoLiberadoAcumulado;

    // Paso 1: Cada deuda activa amortiza su cuota base mensual
    for (let d of debts) {
      if (d.saldo > 0) {
        const pago = Math.min(d.saldo, d.pagoBase);
        d.saldo -= pago;
        if (d.saldo <= 0 && !d.mesEliminada) {
          d.mesEliminada = mes;
          flujoLiberadoAcumulado += d.pagoBase;
        }
      }
    }

    // Paso 2: El fondo acelerador ataca en cascada a la deuda activa #1 según la estrategia
    for (let d of debts) {
      if (d.saldo > 0 && extraDisponibleEsteMes > 0) {
        const pagoExtra = Math.min(d.saldo, extraDisponibleEsteMes);
        d.saldo -= pagoExtra;
        extraDisponibleEsteMes -= pagoExtra;
        if (d.saldo <= 0 && !d.mesEliminada) {
          d.mesEliminada = mes;
          flujoLiberadoAcumulado += d.pagoBase;
        }
      }
    }
  }

  // Asegurar mesEliminada para todas las deudas
  debts.forEach(d => {
    if (!d.mesEliminada) d.mesEliminada = mes;
  });

  return {
    totalMeses: mes,
    debts: debts
  };
}

function ejecutarSimuladorDeuda(aporteExtra) {
  if (!window._eduDataSimulador) return;
  const { deudas, totalDeuda } = window._eduDataSimulador;

  const mesesFinalEl = document.getElementById('simuladorMesesFinal');
  const ahorroEl = document.getElementById('simuladorAhorroMeses');
  const fechaEl = document.getElementById('simuladorFechaLibertad');
  const ritmoEl = document.getElementById('simuladorRitmoBadge');
  const cronogramaEl = document.getElementById('simuladorCronograma');
  const countEl = document.getElementById('simuladorDeudasCount');

  if (countEl) countEl.textContent = `${deudas.length} deudas pendientes (${formatMoney(totalDeuda)})`;

  if (!deudas || deudas.length === 0 || totalDeuda === 0) {
    if (mesesFinalEl) mesesFinalEl.textContent = '0 meses';
    if (ahorroEl) ahorroEl.textContent = '¡Sin deudas pendientes!';
    if (fechaEl) fechaEl.textContent = '¡Hoy mismo!';
    if (ritmoEl) ritmoEl.textContent = 'Libre de pasivos';
    if (cronogramaEl) {
      cronogramaEl.innerHTML = `
        <div class="col-span-full p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-center text-xs text-emerald-300">
          🎉 ¡Excelente! No tienes deudas pendientes. Todo tu flujo disponible puede ir al fondo de reserva o a inversiones.
        </div>
      `;
    }
    return;
  }

  // 1. Simulación base (sin aporte extra) según la estrategia actual
  const simBase = simularAmortizacionBolaNieve(deudas, 0, currentEstrategiaDeuda);

  // 2. Simulación acelerada con aporte extra actual según la estrategia actual
  const simAcelerada = simularAmortizacionBolaNieve(deudas, aporteExtra, currentEstrategiaDeuda);

  const mesesBase = simBase.totalMeses;
  const mesesActual = simAcelerada.totalMeses;
  const mesesAhorrados = Math.max(0, mesesBase - mesesActual);

  if (mesesFinalEl) {
    mesesFinalEl.textContent = `${mesesActual} ${mesesActual === 1 ? 'mes' : 'meses'}`;
  }

  if (ahorroEl) {
    if (aporteExtra > 0 && mesesAhorrados > 0) {
      ahorroEl.innerHTML = `⚡ ¡Ahorras <strong>${mesesAhorrados} ${mesesAhorrados === 1 ? 'mes' : 'meses'}</strong>!`;
      ahorroEl.className = 'text-[10px] text-emerald-400 font-bold mt-0.5';
    } else if (aporteExtra > 0) {
      ahorroEl.textContent = `Acelerando desahogo de deudas`;
      ahorroEl.className = 'text-[10px] text-amber-400 font-semibold mt-0.5';
    } else {
      ahorroEl.textContent = `Ritmo normal (sin extra)`;
      ahorroEl.className = 'text-[10px] text-slate-400 font-semibold mt-0.5';
    }
  }

  // Proyectar fecha de libertad
  const fechaFin = new Date();
  fechaFin.setMonth(fechaFin.getMonth() + mesesActual);
  const nombreMes = fechaFin.toLocaleString('es-AR', { month: 'long' });
  const anio = fechaFin.getFullYear();
  const fechaStr = `${nombreMes.charAt(0).toUpperCase() + nombreMes.slice(1)} ${anio}`;

  if (fechaEl) fechaEl.textContent = fechaStr;
  if (ritmoEl) {
    if (aporteExtra > 0) {
      ritmoEl.textContent = `Con +${formatMoney(aporteExtra)} al mes`;
      ritmoEl.className = 'text-[10px] text-indigo-300 font-semibold mt-0.5';
    } else {
      ritmoEl.textContent = `Sin aporte extra`;
      ritmoEl.className = 'text-[10px] text-slate-500 mt-0.5';
    }
  }

  // Renderizar cascada cronograma (top 6 deudas ordenadas de la estrategia activa)
  if (cronogramaEl) {
    const topDebts = simAcelerada.debts.slice(0, 6);
    cronogramaEl.innerHTML = topDebts.map((d, idx) => {
      const mesElim = d.mesEliminada || simAcelerada.totalMeses;
      const fElim = new Date();
      fElim.setMonth(fElim.getMonth() + mesElim);
      const fMes = fElim.toLocaleString('es-AR', { month: 'short' });
      const fAnio = fElim.getFullYear();

      const esPrimera = idx === 0;
      return `
        <div class="p-3 rounded-xl ${esPrimera ? 'bg-indigo-950/40 border-indigo-500/40 shadow-sm' : 'bg-slate-900 border-slate-800'} border space-y-1.5 transition hover:border-slate-700">
          <div class="flex items-center justify-between">
            <span class="font-bold text-white text-xs truncate max-w-[130px] sm:max-w-[150px]" title="${d.nombre}">
              #${idx + 1} ${d.nombre}
            </span>
            <span class="text-[10px] font-bold px-1.5 py-0.5 rounded ${esPrimera ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30' : 'bg-slate-800 text-slate-300'}">
              Mes ${mesElim} (${fMes} ${fAnio})
            </span>
          </div>
          <div class="flex items-center justify-between text-[11px] text-slate-400">
            <span>Saldo: <strong class="text-rose-400">${formatMoney(d.saldoInicial)}</strong></span>
            <span class="text-[10px] text-emerald-400 font-semibold">+${formatMoney(d.pagoBase)}/mes libre</span>
          </div>
          <div class="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden mt-1">
            <div style="width: ${Math.min(100, Math.round(((topDebts.length - idx) / topDebts.length) * 100))}%" class="h-full bg-gradient-to-r from-amber-500 to-emerald-500 rounded-full"></div>
          </div>
        </div>
      `;
    }).join('');
  }

  if (window.lucide) lucide.createIcons();
}

// ==========================================
// COPILOTO FINANCIERO IA (INPUT Y ASESOR)
// ==========================================

function switchAgenteTab(tab) {
  const tabRegistro = document.getElementById('agenteTab-registro');
  const tabAsesor = document.getElementById('agenteTab-asesor');
  const btnRegistro = document.getElementById('agenteTabBtn-registro');
  const btnAsesor = document.getElementById('agenteTabBtn-asesor');

  if (tab === 'registro') {
    tabRegistro.classList.remove('hidden');
    tabAsesor.classList.add('hidden');
    btnRegistro.classList.add('border-emerald-500', 'text-emerald-400', 'font-bold');
    btnRegistro.classList.remove('border-transparent', 'text-slate-400');
    btnAsesor.classList.remove('border-emerald-500', 'text-emerald-400', 'font-bold');
    btnAsesor.classList.add('border-transparent', 'text-slate-400');
  } else {
    tabRegistro.classList.add('hidden');
    tabAsesor.classList.remove('hidden');
    btnAsesor.classList.add('border-emerald-500', 'text-emerald-400', 'font-bold');
    btnAsesor.classList.remove('border-transparent', 'text-slate-400');
    btnRegistro.classList.remove('border-emerald-500', 'text-emerald-400', 'font-bold');
    btnRegistro.classList.add('border-transparent', 'text-slate-400');
  }
  if (window.lucide) lucide.createIcons();
}

function copiarEjemploGasto(texto) {
  const input = document.getElementById('inputGastoIATexto');
  if (input) {
    input.value = texto;
    input.focus();
  }
}

async function handleRegistrarGastoIA(event) {
  event.preventDefault();
  const input = document.getElementById('inputGastoIATexto');
  const btn = document.getElementById('btnSubmitGastoIA');
  const boxResultado = document.getElementById('boxResultadoGastoIA');
  const txtTitulo = document.getElementById('resultadoGastoIATitulo');
  const txtDetalle = document.getElementById('resultadoGastoIADetalle');

  const texto = input.value.trim();
  if (!texto) return;

  try {
    btn.disabled = true;
    btn.innerHTML = `<span class="animate-spin mr-2">⚙️</span> Procesando con IA...`;

    const res = await authFetch(`${API_BASE}/agente/parse-gasto`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texto })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error procesando gasto con IA');

    txtTitulo.textContent = 'Gasto Registrado con Éxito';
    txtDetalle.innerHTML = `
      <strong>${data.gasto.nombre}</strong> por <strong>${formatMoney(data.gasto.monto)}</strong>
      <span class="text-xs text-slate-400">(${data.gasto.categoria})</span>
      ${data.gasto.detalles ? `<br><span class="text-[11px] text-slate-400">${data.gasto.detalles}</span>` : ''}
    `;
    boxResultado.classList.remove('hidden');

    input.value = '';
    showToast(data.mensaje || 'Gasto registrado correctamente');
    await loadAllData();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<i data-lucide="sparkles" class="w-4 h-4"></i><span>Interpretar y Guardar Gasto</span>`;
    if (window.lucide) lucide.createIcons();
  }
}

function formatMarkdown(text) {
  if (!text) return '';
  let html = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/^[*-]\s+(.*)$/gm, '<li class="ml-4 list-disc">$1</li>');
  html = html.replace(/\n/g, '<br>');
  return html;
}

function enviarPreguntaRapida(pregunta) {
  const input = document.getElementById('inputPreguntaAsesor');
  if (input) {
    input.value = pregunta;
    handleEnviarPreguntaAsesor(new Event('submit'));
  }
}

async function handleEnviarPreguntaAsesor(event) {
  if (event && event.preventDefault) event.preventDefault();

  const input = document.getElementById('inputPreguntaAsesor');
  const chatContainer = document.getElementById('chatAsesorMessages');
  const btn = document.getElementById('btnEnviarPregunta');

  const pregunta = input.value.trim();
  if (!pregunta) return;

  // Mensaje del usuario
  const userMsgEl = document.createElement('div');
  userMsgEl.className = 'flex items-start gap-2.5 justify-end';
  userMsgEl.innerHTML = `
    <div class="bg-emerald-500/20 border border-emerald-500/30 rounded-2xl rounded-tr-none p-3 text-emerald-200 leading-relaxed max-w-[85%]">
      ${pregunta}
    </div>
    <div class="w-6 h-6 rounded-lg bg-emerald-500 text-slate-950 font-bold text-[10px] flex items-center justify-center shrink-0 mt-0.5">
      Tú
    </div>
  `;
  chatContainer.appendChild(userMsgEl);
  input.value = '';

  // Mensaje de carga
  const botMsgEl = document.createElement('div');
  botMsgEl.className = 'flex items-start gap-2.5';
  botMsgEl.innerHTML = `
    <div class="w-6 h-6 rounded-lg bg-teal-500/20 text-teal-400 flex items-center justify-center shrink-0 mt-0.5">
      <i data-lucide="bot" class="w-3.5 h-3.5"></i>
    </div>
    <div class="bg-slate-900 border border-slate-800 rounded-2xl rounded-tl-none p-3 text-slate-400 leading-relaxed max-w-[85%] animate-pulse">
      Consultando tus finanzas con la IA...
    </div>
  `;
  chatContainer.appendChild(botMsgEl);
  chatContainer.scrollTop = chatContainer.scrollHeight;
  if (window.lucide) lucide.createIcons();

  try {
    btn.disabled = true;

    const res = await authFetch(`${API_BASE}/agente/consulta`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pregunta })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al consultar al asesor');

    const botTextContainer = botMsgEl.querySelector('.bg-slate-900');
    botTextContainer.classList.remove('animate-pulse', 'text-slate-400');
    botTextContainer.classList.add('text-slate-200');
    botTextContainer.innerHTML = formatMarkdown(data.respuesta);
  } catch (err) {
    const botTextContainer = botMsgEl.querySelector('.bg-slate-900');
    botTextContainer.classList.remove('animate-pulse');
    botTextContainer.classList.add('text-rose-400');
    botTextContainer.textContent = `Error: ${err.message}`;
  } finally {
    btn.disabled = false;
    chatContainer.scrollTop = chatContainer.scrollHeight;
    if (window.lucide) lucide.createIcons();
  }
}

// ==========================================
// 6. METAS DE AHORRO ("CAJITAS / POCKETS")
// ==========================================

async function loadMetas() {
  if (!authToken) return;
  try {
    const res = await authFetch(`${API_BASE}/metas`);
    if (!res.ok) return;
    const metas = await res.json();
    currentMetasList = metas || [];

    const badge = document.getElementById('badgeMetasCount');
    if (badge) badge.textContent = `${currentMetasList.length} ${currentMetasList.length === 1 ? 'Meta' : 'Metas'}`;

    const grid = document.getElementById('gridMetasAhorro');
    if (!grid) return;

    if (currentMetasList.length === 0) {
      grid.innerHTML = `
        <div class="col-span-full py-8 text-center text-slate-500 text-xs bg-slate-900/40 border border-slate-800 rounded-2xl">
          <div class="text-2xl mb-1">🎯</div>
          <p class="font-medium text-slate-400">No tienes metas de ahorro activas aún.</p>
          <p class="text-[11px] text-slate-500 mt-0.5">Haz clic en <strong>+ Nueva Meta</strong> para apartar dinero para tus vacaciones, auto o fondo de reserva.</p>
        </div>
      `;
      return;
    }

    grid.innerHTML = currentMetasList.map(m => {
      const actual = Number(m.monto_actual) || 0;
      const objetivo = Number(m.monto_objetivo) || 1;
      const pct = Math.min(100, Math.round((actual / objetivo) * 100));
      const restante = Math.max(0, objetivo - actual);
      const isCompletada = actual >= objetivo;

      return `
        <div class="bg-slate-900/80 border ${isCompletada ? 'border-emerald-500/40 shadow-lg shadow-emerald-500/10' : 'border-slate-800'} rounded-2xl p-4 sm:p-5 space-y-3.5 relative overflow-hidden transition hover:border-slate-700">
          <div class="flex justify-between items-start">
            <div class="flex items-center gap-2.5">
              <span class="text-2xl p-2 rounded-xl bg-slate-800/80 border border-slate-700/60">${m.icono || '🎯'}</span>
              <div>
                <h4 class="font-bold text-white text-sm">${m.nombre}</h4>
                <div class="text-[11px] text-slate-400">
                  ${m.cuenta_nombre ? `Asociada a: <span class="text-slate-300 font-medium">${m.cuenta_nombre}</span>` : 'Sin cuenta vinculada'}
                </div>
              </div>
            </div>
            <button onclick="eliminarMeta(${m.id})" title="Eliminar meta" class="text-slate-500 hover:text-rose-400 p-1.5 rounded-lg hover:bg-slate-800 transition active:scale-95">
              <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
            </button>
          </div>

          <div class="space-y-1.5">
            <div class="flex justify-between items-baseline text-xs">
              <span class="text-slate-400 font-medium">Ahorrado:</span>
              <div class="text-right">
                <span class="font-extrabold ${isCompletada ? 'text-emerald-400' : 'text-amber-400'} text-sm sm:text-base">${formatMoney(actual)}</span>
                <span class="text-[11px] text-slate-500"> / ${formatMoney(objetivo)}</span>
              </div>
            </div>
            <div class="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
              <div class="h-full rounded-full transition-all duration-500 ${isCompletada ? 'bg-gradient-to-r from-emerald-500 to-teal-400' : 'bg-gradient-to-r from-amber-500 to-yellow-400'}" style="width: ${pct}%"></div>
            </div>
            <div class="flex justify-between items-center text-[10px] text-slate-400 pt-0.5">
              <span>${pct}% alcanzado</span>
              <span class="font-medium">${isCompletada ? '🎉 ¡Meta cumplida!' : `Faltan ${formatMoney(restante)}`}</span>
            </div>
          </div>

          <div class="pt-2 border-t border-slate-800/80 flex items-center justify-between">
            <div class="text-[10px] text-slate-500">
              ${m.fecha_limite ? `Límite: ${formatDate(m.fecha_limite)}` : 'Sin plazo'}
            </div>
            <button onclick="abrirModalAportarMeta(${m.id})" class="px-3 py-1.5 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 font-semibold text-xs border border-amber-500/30 transition active:scale-95 flex items-center gap-1.5">
              <i data-lucide="plus-circle" class="w-3.5 h-3.5"></i>
              <span>Depositar</span>
            </button>
          </div>
        </div>
      `;
    }).join('');

    if (window.lucide) lucide.createIcons();
  } catch (err) {
    console.error('Error cargando metas de ahorro:', err);
  }
}

async function abrirModalCrearMeta() {
  const form = document.getElementById('formMetaAhorro');
  if (form) form.reset();

  const selCuenta = document.getElementById('metaCuentaSelect');
  if (selCuenta) {
    selCuenta.innerHTML = '<option value="">Ninguna cuenta vinculada</option>' +
      (currentCuentasList || []).map(c => `<option value="${c.id}">${c.nombre} (Saldo: ${formatMoney(c.saldo)})</option>`).join('');
  }

  openModal('modalMetaAhorro');
  setTimeout(() => document.getElementById('metaNombre')?.focus(), 100);
}

async function handleCrearMeta(event) {
  event.preventDefault();
  const nombre = document.getElementById('metaNombre')?.value.trim();
  const montoObjetivo = parseFloat(document.getElementById('metaMontoObjetivo')?.value);
  const montoActual = parseFloat(document.getElementById('metaMontoActual')?.value) || 0;
  const fechaLimite = document.getElementById('metaFechaLimite')?.value || null;
  const icono = document.getElementById('metaIcono')?.value || '🎯';
  const cuentaId = document.getElementById('metaCuentaSelect')?.value || null;

  if (!nombre || isNaN(montoObjetivo) || montoObjetivo <= 0) {
    showToast('Ingresa un nombre y un monto objetivo válido', 'error');
    return;
  }

  try {
    const res = await authFetch(`${API_BASE}/metas`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nombre,
        monto_objetivo: montoObjetivo,
        monto_actual: montoActual,
        fecha_limite: fechaLimite,
        icono,
        cuenta_id: cuentaId ? parseInt(cuentaId, 10) : null
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al guardar la meta');

    closeModal('modalMetaAhorro');
    showToast('Meta de ahorro creada con éxito');
    await loadMetas();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function abrirModalAportarMeta(metaId) {
  const meta = (currentMetasList || []).find(m => m.id === metaId);
  if (!meta) return;

  const idInput = document.getElementById('aportarMetaId');
  const titInput = document.getElementById('aportarMetaTitulo');
  const icoInput = document.getElementById('aportarMetaIcono');
  const montoInput = document.getElementById('aportarMetaMonto');
  const selCuenta = document.getElementById('aportarMetaCuentaSelect');

  if (idInput) idInput.value = meta.id;
  if (titInput) titInput.textContent = `Aportar a: ${meta.nombre}`;
  if (icoInput) icoInput.textContent = meta.icono || '🎯';
  if (montoInput) montoInput.value = '';

  if (selCuenta) {
    selCuenta.innerHTML = '<option value="">No debitar (depósito externo en efectivo)</option>' +
      (currentCuentasList || []).map(c => `<option value="${c.id}" ${meta.cuenta_id === c.id ? 'selected' : ''}>${c.nombre} (Saldo: ${formatMoney(c.saldo)})</option>`).join('');
  }

  openModal('modalAportarMeta');
  setTimeout(() => montoInput?.focus(), 100);
}

async function handleConfirmarAporteMeta(event) {
  event.preventDefault();
  const id = document.getElementById('aportarMetaId')?.value;
  const monto = parseFloat(document.getElementById('aportarMetaMonto')?.value);
  const cuentaId = document.getElementById('aportarMetaCuentaSelect')?.value || null;

  if (!id || isNaN(monto) || monto <= 0) {
    showToast('Ingresa un monto válido para aportar', 'error');
    return;
  }

  try {
    const res = await authFetch(`${API_BASE}/metas/${id}/aportar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        monto,
        cuenta_id: cuentaId ? parseInt(cuentaId, 10) : null
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al registrar el depósito');

    closeModal('modalAportarMeta');
    showToast(data.message || 'Depósito realizado con éxito');
    await loadAllData();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function eliminarMeta(id) {
  if (!confirm('¿Eliminar esta meta de ahorro?')) return;
  try {
    const res = await authFetch(`${API_BASE}/metas/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Error al eliminar');
    showToast('Meta eliminada');
    await loadMetas();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ==========================================
// 7. PRESUPUESTOS (SEMÁFORO DE GASTO)
// ==========================================

async function loadPresupuestos() {
  if (!authToken) return;
  try {
    const currentMonth = new Date().toISOString().substring(0, 7);
    const res = await authFetch(`${API_BASE}/presupuestos?mes=${currentMonth}`);
    if (!res.ok) return;
    const data = await res.json();
    currentPresupuestosList = (data && data.presupuestos) ? data.presupuestos : (Array.isArray(data) ? data : []);

    const grid = document.getElementById('gridPresupuestos');
    if (!grid) return;

    const categoriasInfo = [
      { id: 'operativo', label: 'Operativo / Fijo', defaultTope: 250000, icon: 'shield' },
      { id: 'credito', label: 'Crédito / Tarjetas', defaultTope: 300000, icon: 'credit-card' },
      { id: 'impuesto', label: 'Impuestos / Servicios', defaultTope: 100000, icon: 'receipt' }
    ];

    grid.innerHTML = categoriasInfo.map(cat => {
      const pres = currentPresupuestosList.find(p => p.categoria === cat.id);
      const tope = pres ? (Number(pres.monto_limite) || Number(pres.limite) || cat.defaultTope) : cat.defaultTope;
      
      const consumido = (pres && pres.gastado !== undefined) 
        ? Number(pres.gastado) 
        : (currentGastosList || []).filter(g => g.categoria === cat.id).reduce((sum, g) => sum + (Number(g.monto) || 0), 0);

      const pct = tope > 0 ? Math.round((consumido / tope) * 100) : 0;

      let colorBadge = 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20 font-bold';
      let barColor = 'bg-emerald-500';
      let estadoTexto = 'Dentro del límite';
      if (pct >= 100) {
        colorBadge = 'text-rose-400 bg-rose-500/10 border-rose-500/20 font-bold';
        barColor = 'bg-rose-500';
        estadoTexto = '⚠️ Presupuesto Excedido';
      } else if (pct >= 80) {
        colorBadge = 'text-amber-400 bg-amber-500/10 border-amber-500/20 font-bold';
        barColor = 'bg-amber-400';
        estadoTexto = 'Cerca del límite';
      }

      return `
        <div class="p-3 rounded-xl bg-slate-950/70 border border-slate-800 space-y-2">
          <div class="flex items-center justify-between">
            <span class="text-xs font-bold text-white flex items-center gap-1.5">
              <i data-lucide="${cat.icon}" class="w-3.5 h-3.5 text-slate-400"></i>
              <span>${cat.label}</span>
            </span>
            <span class="text-[10px] px-2 py-0.5 rounded-full border ${colorBadge}">
              ${pct}%
            </span>
          </div>
          <div class="flex justify-between items-baseline text-xs">
            <span class="text-slate-400 text-[11px]">Gastado: <strong class="text-slate-200">${formatMoney(consumido)}</strong></span>
            <span class="text-slate-500 text-[10px]">Tope: ${formatMoney(tope)}</span>
          </div>
          <div class="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
            <div class="${barColor} h-full rounded-full transition-all duration-300" style="width: ${Math.min(100, pct)}%"></div>
          </div>
          <div class="flex justify-between items-center text-[10px] text-slate-400">
            <span>${estadoTexto}</span>
            <button onclick="abrirModalPresupuesto('${cat.id}', ${tope})" class="text-emerald-400 hover:text-emerald-300 font-medium transition">Ajustar</button>
          </div>
        </div>
      `;
    }).join('');

    if (window.lucide) lucide.createIcons();
  } catch (err) {
    console.error('Error cargando presupuestos:', err);
  }
}

function abrirModalPresupuesto(catId = 'operativo', montoActual = null) {
  const selCat = document.getElementById('presupuestoCategoria');
  const inpMonto = document.getElementById('presupuestoMonto');

  if (selCat && catId) selCat.value = catId;
  if (inpMonto) {
    inpMonto.value = montoActual || 250000;
  }
  openModal('modalPresupuesto');
  setTimeout(() => inpMonto?.focus(), 100);
}

async function handleGuardarPresupuesto(event) {
  event.preventDefault();
  const categoria = document.getElementById('presupuestoCategoria')?.value;
  const monto = parseFloat(document.getElementById('presupuestoMonto')?.value);
  const currentMonth = new Date().toISOString().substring(0, 7);

  if (!categoria || isNaN(monto) || monto <= 0) {
    showToast('Ingresa un monto límite válido', 'error');
    return;
  }

  try {
    const res = await authFetch(`${API_BASE}/presupuestos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        categoria,
        monto_limite: monto,
        mes: currentMonth
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al guardar presupuesto');

    closeModal('modalPresupuesto');
    showToast('Límite de presupuesto guardado');
    await loadPresupuestos();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ==========================================
// 8. ESCANEO DE TICKETS CON VISIÓN IA (GEMINI)
// ==========================================

function abrirModalEscanearTicket() {
  limpiarPreviewTicket();
  openModal('modalEscanearTicket');
}

function handleArchivoTicketSeleccionado(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;

  if (!file.type.startsWith('image/')) {
    showToast('Por favor selecciona un archivo de imagen (PNG, JPG, WebP)', 'error');
    return;
  }

  const reader = new FileReader();
  reader.onload = function(e) {
    const dataUrl = e.target.result;
    const base64Data = dataUrl.split(',')[1];
    ticketSeleccionadoBase64 = base64Data;
    ticketSeleccionadoMimeType = file.type;

    const img = document.getElementById('imgPreviewTicket');
    const box = document.getElementById('boxPreviewTicket');
    const btn = document.getElementById('btnEscanearTicketSubmit');

    if (img) img.src = dataUrl;
    if (box) box.classList.remove('hidden');
    if (btn) btn.disabled = false;
  };
  reader.readAsDataURL(file);
}

function limpiarPreviewTicket() {
  ticketSeleccionadoBase64 = null;
  ticketSeleccionadoMimeType = null;
  const input = document.getElementById('inputTicketFile');
  if (input) input.value = '';
  const box = document.getElementById('boxPreviewTicket');
  if (box) box.classList.add('hidden');
  const img = document.getElementById('imgPreviewTicket');
  if (img) img.src = '';
  const btn = document.getElementById('btnEscanearTicketSubmit');
  if (btn) btn.disabled = true;
  const estado = document.getElementById('estadoProcesandoTicket');
  if (estado) estado.classList.add('hidden');
}

async function procesarTicketConIA() {
  if (!ticketSeleccionadoBase64) {
    showToast('Selecciona o arrastra una imagen de comprobante primero', 'error');
    return;
  }

  const btn = document.getElementById('btnEscanearTicketSubmit');
  const estado = document.getElementById('estadoProcesandoTicket');

  try {
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<span class="animate-spin mr-2">⚙️</span> Analizando con Gemini Visión...`;
    }
    if (estado) estado.classList.remove('hidden');

    const res = await authFetch(`${API_BASE}/agente/escanear-ticket`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imagenBase64: ticketSeleccionadoBase64,
        mimeType: ticketSeleccionadoMimeType || 'image/jpeg'
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al interpretar comprobante');

    closeModal('modalEscanearTicket');
    limpiarPreviewTicket();

    // Precargar modal de gasto para confirmación del usuario
    const gasto = data.gasto || {};
    const inputNombre = document.getElementById('inputGastoNombre');
    const inputMonto = document.getElementById('inputGastoMonto');
    const selectCat = document.getElementById('inputGastoCategoria');
    const inputVenc = document.getElementById('inputGastoVencimiento');
    const inputDet = document.getElementById('inputGastoDetalles');
    const elTitulo = document.getElementById('modalGastoTitulo');
    const inputId = document.getElementById('inputGastoId');

    if (inputId) inputId.value = '';
    if (elTitulo) elTitulo.textContent = 'Gasto Detectado por IA (Confirmar)';
    if (inputNombre) inputNombre.value = gasto.nombre || 'Ticket Comercio';
    if (inputMonto) inputMonto.value = gasto.monto || '';
    if (selectCat) selectCat.value = gasto.categoria || 'operativo';
    if (inputVenc && gasto.vencimiento) inputVenc.value = gasto.vencimiento;
    if (inputDet) inputDet.value = gasto.detalles || 'Escaneado con Gemini Visión';

    openModal('modalGasto');
    showToast(`Comprobante interpretado: ${gasto.nombre || 'Ticket'} por ${formatMoney(gasto.monto || 0)}`);
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<i data-lucide="sparkles" class="w-4 h-4"></i><span>Interpretar y Pasar a Gastos</span>`;
      if (window.lucide) lucide.createIcons();
    }
    if (estado) estado.classList.add('hidden');
  }
}

// Pegar imagen del portapapeles (Ctrl+V) cuando el modal de ticket está abierto
window.addEventListener('paste', (e) => {
  const modal = document.getElementById('modalEscanearTicket');
  if (!modal || modal.classList.contains('hidden')) return;

  const items = (e.clipboardData || e.originalEvent?.clipboardData)?.items;
  if (!items) return;

  for (let i = 0; i < items.length; i++) {
    if (items[i].type.indexOf('image') !== -1) {
      const blob = items[i].getAsFile();
      handleArchivoTicketSeleccionado({ target: { files: [blob] } });
      showToast('Imagen del portapapeles cargada');
      break;
    }
  }
});

// ==========================================
// 9. REPORTE EJECUTIVO MENSUAL (PDF) & CSV
// ==========================================

function abrirModalReporteMensual() {
  const elFecha = document.getElementById('reporteFechaEmision');
  if (elFecha) {
    const hoy = new Date().toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' });
    elFecha.textContent = `Generado el ${hoy}`;
  }

  const elIng = document.getElementById('repIngresos');
  const elGas = document.getElementById('repGastos');
  const elLiq = document.getElementById('repLiquidez');
  const elInv = document.getElementById('repInversiones');

  const totalIng = document.getElementById('kpiIngresosMes')?.textContent || '$ 0';
  const totalGas = document.getElementById('kpiGastosPendientes')?.textContent || '$ 0';
  const totalLiq = document.getElementById('kpiSaldoTotal')?.textContent || '$ 0';
  const totalInv = document.getElementById('kpiInversiones')?.textContent || '$ 0';

  if (elIng) elIng.textContent = totalIng;
  if (elGas) elGas.textContent = totalGas;
  if (elLiq) elLiq.textContent = totalLiq;
  if (elInv) elInv.textContent = totalInv;

  const tbody = document.getElementById('repTablaGastosBody');
  if (tbody) {
    if (!currentGastosList || currentGastosList.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4" class="p-3 text-center text-slate-500">No hay gastos en el período</td></tr>`;
    } else {
      tbody.innerHTML = currentGastosList.map(g => `
        <tr class="hover:bg-slate-900/40">
          <td class="p-2.5 font-semibold text-white">${g.nombre}</td>
          <td class="p-2.5 text-slate-400 capitalize">${g.categoria}</td>
          <td class="p-2.5 font-bold text-slate-200">${formatMoney(g.monto)}</td>
          <td class="p-2.5">
            <span class="px-2 py-0.5 rounded text-[10px] uppercase font-bold ${g.estado === 'pagado' ? 'text-emerald-400 bg-emerald-500/10' : 'text-amber-400 bg-amber-500/10'}">
              ${g.estado}
            </span>
          </td>
        </tr>
      `).join('');
    }
  }

  const elScore = document.getElementById('repScoreSalud');
  const elConsejo = document.getElementById('repScoreConsejo');
  const scoreBadge = document.getElementById('diagScoreNumber')?.textContent;
  if (elScore && scoreBadge) {
    elScore.textContent = `${scoreBadge} / 100`;
  }
  const consejoBadge = document.getElementById('diagMensajeGeneral')?.textContent;
  if (elConsejo && consejoBadge) {
    elConsejo.textContent = consejoBadge;
  }

  openModal('modalReporteMensual');
  if (window.lucide) lucide.createIcons();
}

function imprimirReporteMensual() {
  window.print();
}

function exportarGastosCSV() {
  if (!currentGastosList || currentGastosList.length === 0) {
    showToast('No hay gastos registrados para exportar', 'error');
    return;
  }

  const headers = ['ID', 'Nombre / Concepto', 'Categoria', 'Monto (ARS)', 'Monto Pagado', 'Vencimiento', 'Estado', 'Detalles'];
  const rows = currentGastosList.map(g => [
    g.id,
    `"${(g.nombre || '').replace(/"/g, '""')}"`,
    g.categoria || '',
    g.monto || 0,
    g.monto_pagado || 0,
    g.vencimiento || '',
    g.estado || '',
    `"${(g.detalles || '').replace(/"/g, '""')}"`
  ]);

  const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const fecha = new Date().toISOString().substring(0, 10);
  a.href = url;
  a.download = `metrica_gastos_${fecha}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('Planilla CSV descargada con éxito');
}

// ==========================================
// MODO MULTI-ESPACIO: PERSONAL VS NEGOCIOS VS CONTADOR B2B
// ==========================================

function mostrarModalBloqueoPlan(modulo) {
  const elTitulo = document.getElementById('bloqueoPlanTitulo');
  const elMensaje = document.getElementById('bloqueoPlanMensaje');
  if (modulo === 'negocios') {
    if (elTitulo) elTitulo.textContent = 'Métrica Negocios & Freelancers';
    if (elMensaje) elMensaje.textContent = 'El control de clientes, emisión de facturas y el termómetro de Monotributo AFIP requieren el Plan Negocios. Tu período de prueba de 15 días ha concluido.';
  } else if (modulo === 'contador') {
    if (elTitulo) elTitulo.textContent = 'Métrica Contador Partner B2B';
    if (elMensaje) elMensaje.textContent = 'El panel multi-cliente con semáforo de Monotributo, alertas de WhatsApp y reportes para estudios contables es exclusivo del Plan Contador Partner.';
  } else if (modulo === 'ia') {
    if (elTitulo) elTitulo.textContent = 'Copiloto Financiero IA';
    if (elMensaje) elMensaje.textContent = 'El asistente financiero inteligente con visión OCR de tickets y chat ilimitado requiere el Plan Pro Personal o superior.';
  }
  openModal('modalBloqueoPlan');
  if (window.lucide) lucide.createIcons();
}

function switchWorkspaceMode(mode) {
  // Validación de acceso (Admin, Free Trial 15 días o Plan Contratado)
  if (currentUser) {
    const esAdmin = Boolean(currentUser.rol === 'admin' || currentUser.plan_suscripcion === 'admin' || (currentUser.trial && currentUser.trial.esAdmin));
    const isTrialActivo = Boolean(currentUser.trial && currentUser.trial.activo);
    const plan = currentUser.plan_suscripcion || 'free';

    if (mode === 'negocios') {
      const tieneAcceso = esAdmin || isTrialActivo || plan === 'pro_negocios' || plan === 'contador_partner';
      if (!tieneAcceso) {
        mostrarModalBloqueoPlan('negocios');
        return;
      }
    } else if (mode === 'contador') {
      const tieneAcceso = esAdmin || isTrialActivo || plan === 'contador_partner';
      if (!tieneAcceso) {
        mostrarModalBloqueoPlan('contador');
        return;
      }
    }
  }

  currentWorkspaceMode = mode;
  localStorage.setItem('metrica_active_mode', mode);

  const wsPersonal = document.getElementById('workspacePersonal');
  const wsNegocios = document.getElementById('workspaceNegocios');
  const wsContador = document.getElementById('workspaceContador');

  const btnPersonal = document.getElementById('btnModePersonal');
  const btnNegocios = document.getElementById('btnModeNegocios');
  const btnContador = document.getElementById('btnModeContador');
  const btnPersonalMobile = document.getElementById('btnModePersonalMobile');
  const btnNegociosMobile = document.getElementById('btnModeNegociosMobile');
  const btnContadorMobile = document.getElementById('btnModeContadorMobile');
  const subtitle = document.getElementById('headerWorkspaceSubtitle');

  const bottomNavPersonal = document.getElementById('bottomNavPersonal');
  const bottomNavNegocios = document.getElementById('bottomNavNegocios');
  const bottomNavContador = document.getElementById('bottomNavContador');

  // Ocultar todos los workspaces
  if (wsPersonal) wsPersonal.classList.add('hidden');
  if (wsNegocios) wsNegocios.classList.add('hidden');
  if (wsContador) wsContador.classList.add('hidden');

  // Resetear estados de botones desktop
  const inactivoDesktop = 'px-2.5 sm:px-3 py-1 rounded-xl transition-all flex items-center gap-1.5 text-slate-400 hover:text-white bg-[#0d1522] border border-slate-800/80';
  if (btnPersonal) btnPersonal.className = inactivoDesktop;
  if (btnNegocios) btnNegocios.className = inactivoDesktop;
  if (btnContador) btnContador.className = inactivoDesktop;

  // Resetear estados de botones mobile
  const inactivoMobile = 'py-1.5 px-1.5 rounded-xl transition-all flex items-center justify-center gap-1 text-slate-400 hover:text-white bg-[#0d1522] border border-slate-800/80';
  if (btnPersonalMobile) btnPersonalMobile.className = inactivoMobile;
  if (btnNegociosMobile) btnNegociosMobile.className = inactivoMobile;
  if (btnContadorMobile) btnContadorMobile.className = inactivoMobile;

  // Ocultar presets de bottom nav
  if (bottomNavPersonal) bottomNavPersonal.classList.add('hidden');
  if (bottomNavNegocios) bottomNavNegocios.classList.add('hidden');
  if (bottomNavContador) bottomNavContador.classList.add('hidden');

  if (mode === 'contador') {
    if (wsContador) wsContador.classList.remove('hidden');
    if (btnContador) btnContador.className = 'px-2.5 sm:px-3 py-1 rounded-xl transition-all flex items-center gap-1.5 bg-cyan-500/15 border border-cyan-400/60 text-cyan-300 font-bold shadow-[0_0_12px_rgba(0,242,254,0.25)]';
    if (btnContadorMobile) btnContadorMobile.className = 'py-1.5 px-1.5 rounded-xl transition-all flex items-center justify-center gap-1 bg-cyan-500/15 border border-cyan-400/60 text-cyan-300 font-bold shadow-[0_0_12px_rgba(0,242,254,0.25)]';
    if (bottomNavContador) bottomNavContador.classList.remove('hidden');
    if (subtitle) subtitle.textContent = 'Panel Estudio Contable B2B';

    if (authToken) {
      loadContadorData();
    }
  } else if (mode === 'negocios') {
    if (wsNegocios) wsNegocios.classList.remove('hidden');
    if (btnNegocios) btnNegocios.className = 'px-2.5 sm:px-3 py-1 rounded-xl transition-all flex items-center gap-1.5 bg-amber-500/15 border border-amber-400/60 text-amber-300 font-bold shadow-[0_0_12px_rgba(245,158,11,0.25)]';
    if (btnNegociosMobile) btnNegociosMobile.className = 'py-1.5 px-1.5 rounded-xl transition-all flex items-center justify-center gap-1 bg-amber-500/15 border border-amber-400/60 text-amber-300 font-bold shadow-[0_0_12px_rgba(245,158,11,0.25)]';
    if (bottomNavNegocios) bottomNavNegocios.classList.remove('hidden');
    if (subtitle) subtitle.textContent = 'Gestión Comercial & Freelancers';

    if (authToken) {
      loadNegocioData();
    }
  } else {
    if (wsPersonal) wsPersonal.classList.remove('hidden');
    if (btnPersonal) btnPersonal.className = 'px-2.5 sm:px-3 py-1 rounded-xl transition-all flex items-center gap-1.5 bg-teal-500/15 border border-teal-400/60 text-teal-300 font-bold shadow-[0_0_12px_rgba(45,212,191,0.25)]';
    if (btnPersonalMobile) btnPersonalMobile.className = 'py-1.5 px-1.5 rounded-xl transition-all flex items-center justify-center gap-1 bg-teal-500/15 border border-teal-400/60 text-teal-300 font-bold shadow-[0_0_12px_rgba(45,212,191,0.25)]';
    if (bottomNavPersonal) bottomNavPersonal.classList.remove('hidden');
    if (subtitle) subtitle.textContent = 'Finanzas Personales';
  }

  if (window.lucide) lucide.createIcons();
}

function switchNegocioTab(tabKey) {
  const tabs = ['facturas', 'proyectos', 'monotributo', 'ia'];
  tabs.forEach(t => {
    const section = document.getElementById(`tab-negocio-${t}`);
    const btn = document.getElementById(`tabBtn-negocio-${t}`);
    if (t === tabKey) {
      if (section) section.classList.remove('hidden');
      if (btn) {
        btn.className = 'tab-btn-negocio pb-3 sm:pb-4 text-xs sm:text-sm font-semibold border-b-2 border-amber-500 text-amber-400 flex items-center gap-2';
      }
    } else {
      if (section) section.classList.add('hidden');
      if (btn) {
        btn.className = 'tab-btn-negocio pb-3 sm:pb-4 text-xs sm:text-sm font-medium border-b-2 border-transparent text-slate-400 hover:text-slate-200 flex items-center gap-2';
      }
    }
  });
  if (window.lucide) lucide.createIcons();
}

async function loadNegocioData() {
  await Promise.allSettled([
    loadNegocioResumen(),
    loadNegocioClientes(),
    loadNegocioFacturas(),
    loadNegocioProyectos(),
    loadNegocioMonotributo()
  ]);
  if (window.lucide) lucide.createIcons();
}

async function loadNegocioResumen() {
  try {
    const res = await authFetch('/api/negocio/resumen');
    if (!res.ok) return;
    const data = await res.json();

    const elFacturado = document.getElementById('kpiNegocioFacturado');
    const elFacturadoSub = document.getElementById('kpiNegocioFacturadoSub');
    const elPorCobrar = document.getElementById('kpiNegocioPorCobrar');
    const elPorCobrarCount = document.getElementById('kpiNegocioFacturasPendientesCount');
    const elCostos = document.getElementById('kpiNegocioCostos');
    const elGanancia = document.getElementById('kpiNegocioGananciaNeta');
    const elMargenBadge = document.getElementById('kpiNegocioMargenBadge');

    const facturadoARS = data.facturadoMesARS || 0;
    const facturadoUSD = data.facturadoMesUSD || 0;
    const porCobrarARS = data.porCobrarARS || 0;
    const porCobrarUSD = data.porCobrarUSD || 0;

    let displayFacturado = formatMoney(facturadoARS);
    if (facturadoUSD > 0) displayFacturado += ` + US$ ${facturadoUSD.toLocaleString('en-US')}`;

    let displayPorCobrar = formatMoney(porCobrarARS);
    if (porCobrarUSD > 0) displayPorCobrar += ` + US$ ${porCobrarUSD.toLocaleString('en-US')}`;

    if (elFacturado) elFacturado.textContent = displayFacturado;
    if (elFacturadoSub) elFacturadoSub.textContent = `${data.clientesCount || 0} clientes activos`;
    if (elPorCobrar) elPorCobrar.textContent = displayPorCobrar;
    if (elPorCobrarCount) elPorCobrarCount.textContent = data.facturasPendientesCount || 0;
    if (elCostos) elCostos.textContent = formatMoney(data.costosOperativosMes || 0);
    if (elGanancia) {
      elGanancia.textContent = formatMoney(data.gananciaNetaEstimadaARS || 0);
      elGanancia.className = `text-lg sm:text-2xl font-bold tracking-tight truncate ${(data.gananciaNetaEstimadaARS || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`;
    }
    if (elMargenBadge) {
      const margen = data.margenNetoPorcentaje || 0;
      elMargenBadge.textContent = `Margen: ${margen}%`;
      elMargenBadge.className = `text-[11px] sm:text-xs mt-1 font-semibold flex items-center gap-1 truncate ${margen >= 30 ? 'text-emerald-400' : margen >= 0 ? 'text-amber-400' : 'text-rose-400'}`;
    }

    // Termómetro Monotributo en KPI
    const elCat = document.getElementById('kpiNegocioMonotributoCat');
    const elPct = document.getElementById('kpiNegocioMonotributoPct');
    const elBar = document.getElementById('kpiNegocioMonotributoBar');
    const el12m = document.getElementById('kpiNegocioMonotributoFacturado');
    const elRestante = document.getElementById('kpiNegocioMonotributoRestante');

    const mono = data.monotributo || {};
    const cat = mono.categoria || 'E';
    const pct = mono.porcentajeConsumido || 0;
    const fact12m = mono.facturacion12Meses || 0;
    const tope = mono.topeCategoria || 0;
    const margenLibre = Math.max(0, tope - fact12m);

    if (elCat) elCat.textContent = `Cat. ${cat}`;
    if (elPct) elPct.textContent = `${pct}% tope`;
    if (elBar) elBar.style.width = `${Math.min(100, pct)}%`;
    if (el12m) el12m.textContent = `12m: ${formatMoney(fact12m)}`;
    if (elRestante) elRestante.textContent = `Resta: ${formatMoney(margenLibre)}`;


  } catch (err) {
    console.error('Error cargando resumen comercial:', err);
  }
}

async function loadNegocioClientes() {
  try {
    const res = await authFetch('/api/negocio/clientes');
    if (!res.ok) return;
    const data = await res.json();
    currentNegocioClientesList = Array.isArray(data) ? data : (data.clientes || []);
    renderNegocioClientes(currentNegocioClientesList);
    poblarSelectsClientes(currentNegocioClientesList);
  } catch (err) {
    console.error('Error cargando clientes:', err);
  }
}

function renderNegocioClientes(clientes) {
  const container = document.getElementById('gridNegocioClientes');
  if (!container) return;

  if (!clientes || clientes.length === 0) {
    container.innerHTML = `
      <div class="col-span-full p-8 text-center bg-slate-900/40 rounded-2xl border border-slate-800 space-y-3">
        <div class="w-12 h-12 rounded-2xl bg-amber-500/10 text-amber-400 flex items-center justify-center mx-auto">
          <i data-lucide="users" class="w-6 h-6"></i>
        </div>
        <div>
          <h5 class="text-sm font-bold text-white">Aún no tienes clientes registrados</h5>
          <p class="text-xs text-slate-400">Agrega tus clientes habituales para emitir facturas y cotizaciones en 1 clic.</p>
        </div>
        <button onclick="abrirModalNegocioCliente()" class="px-3.5 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs transition active:scale-95">
          + Agregar Primer Cliente
        </button>
      </div>
    `;
    return;
  }

  container.innerHTML = clientes.map(c => `
    <div class="p-4 rounded-2xl bg-slate-900/80 border border-slate-800 hover:border-slate-700 transition space-y-3 relative group">
      <div class="flex justify-between items-start">
        <div class="flex items-center gap-2.5">
          <div class="w-9 h-9 rounded-xl bg-gradient-to-tr from-amber-500/20 to-yellow-500/20 border border-amber-500/30 text-amber-400 font-bold text-sm flex items-center justify-center shrink-0">
            ${escapeHTML(c.nombre.charAt(0).toUpperCase())}
          </div>
          <div>
            <h5 class="font-bold text-sm text-white leading-tight">${escapeHTML(c.nombre)}</h5>
            <p class="text-[11px] text-slate-400 truncate max-w-[150px]">${escapeHTML(c.empresa || 'Independiente')}</p>
          </div>
        </div>
        <button onclick="eliminarNegocioCliente(${c.id})" title="Eliminar Cliente" class="opacity-0 group-hover:opacity-100 p-1 text-slate-500 hover:text-rose-400 transition">
          <i data-lucide="trash-2" class="w-4 h-4"></i>
        </button>
      </div>

      <div class="space-y-1 text-xs text-slate-300">
        ${c.email ? `<div class="flex items-center gap-1.5 truncate"><i data-lucide="mail" class="w-3.5 h-3.5 text-slate-500"></i><span>${escapeHTML(c.email)}</span></div>` : ''}
        ${c.telefono ? `<div class="flex items-center gap-1.5"><i data-lucide="phone" class="w-3.5 h-3.5 text-slate-500"></i><span>${escapeHTML(c.telefono)}</span></div>` : ''}
        ${c.cuit ? `<div class="flex items-center gap-1.5"><i data-lucide="file-text" class="w-3.5 h-3.5 text-slate-500"></i><span class="text-slate-400">CUIT: ${escapeHTML(c.cuit)}</span></div>` : ''}
      </div>

      <div class="pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px]">
        <span class="px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700/60 font-medium">
          ${escapeHTML(c.condicion_fiscal || 'Consumidor Final')}
        </span>
        <button onclick="abrirModalNegocioFactura(${c.id})" class="text-amber-400 hover:text-amber-300 font-semibold flex items-center gap-1">
          <i data-lucide="plus" class="w-3 h-3"></i> Facturar
        </button>
      </div>
    </div>
  `).join('');
}

function poblarSelectsClientes(clientes) {
  const selectFactura = document.getElementById('selectFacturaCliente');
  const selectProyecto = document.getElementById('selectProyectoCliente');

  const optionsHTML = '<option value="">Selecciona un cliente...</option>' +
    clientes.map(c => `<option value="${c.id}">${escapeHTML(c.nombre)} ${c.empresa ? `(${escapeHTML(c.empresa)})` : ''}</option>`).join('');

  if (selectFactura) selectFactura.innerHTML = optionsHTML;
  if (selectProyecto) selectProyecto.innerHTML = optionsHTML;
}

async function loadNegocioFacturas() {
  try {
    const estadoFiltro = document.getElementById('filterNegocioFacturaEstado')?.value || '';
    const url = estadoFiltro ? `/api/negocio/facturas?estado=${estadoFiltro}` : '/api/negocio/facturas';
    const res = await authFetch(url);
    if (!res.ok) return;
    const data = await res.json();
    currentNegocioFacturasList = Array.isArray(data) ? data : (data.facturas || []);
    renderNegocioFacturas(currentNegocioFacturasList);
  } catch (err) {
    console.error('Error cargando facturas:', err);
  }
}

function renderNegocioFacturas(facturas) {
  const tbody = document.getElementById('tablaNegocioFacturasBody');
  const mobileContainer = document.getElementById('listaNegocioFacturasMobile');
  const badgeTotal = document.getElementById('badgeNegocioTotalFacturas');

  if (badgeTotal) badgeTotal.textContent = `${facturas.length} Facturas`;

  if (!facturas || facturas.length === 0) {
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="6" class="px-5 py-8 text-center text-slate-500">No hay facturas emitidas registradas.</td></tr>';
    }
    if (mobileContainer) {
      mobileContainer.innerHTML = '<div class="p-6 text-center text-xs text-slate-500 bg-slate-900/40 rounded-xl border border-slate-800">No hay facturas emitidas registradas.</div>';
    }
    return;
  }

  // Render Desktop Table
  if (tbody) {
    tbody.innerHTML = facturas.map(f => {
      const isCobrada = f.estado === 'cobrado';
      const isVencida = !isCobrada && f.fecha_vencimiento && new Date(f.fecha_vencimiento) < new Date();
      const statusBadge = isCobrada 
        ? '<span class="px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">Cobrado</span>'
        : isVencida
        ? '<span class="px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20 animate-pulse">Vencida</span>'
        : '<span class="px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">Pendiente</span>';

      return `
        <tr class="hover:bg-slate-800/40 transition">
          <td class="px-5 py-3.5">
            <div class="font-bold text-white">${escapeHTML(f.numero_factura || 'S/N')}</div>
            <div class="text-xs text-slate-400 truncate max-w-xs">${escapeHTML(f.descripcion)}</div>
          </td>
          <td class="px-5 py-3.5">
            <div class="font-semibold text-slate-200">${escapeHTML(f.cliente_nombre || 'Cliente General')}</div>
            <div class="text-xs text-slate-400">${escapeHTML(f.cliente_empresa || '')}</div>
          </td>
          <td class="px-5 py-3.5 font-bold text-white">
            ${f.moneda === 'USD' ? `US$ ${Number(f.monto).toLocaleString('en-US')}` : formatMoney(f.monto)}
          </td>
          <td class="px-5 py-3.5 text-xs ${isVencida ? 'text-rose-400 font-bold' : 'text-slate-400'}">
            ${f.fecha_vencimiento ? f.fecha_vencimiento.substring(0, 10) : '--'}
          </td>
          <td class="px-5 py-3.5">
            ${statusBadge}
          </td>
          <td class="px-5 py-3.5 text-right space-x-1.5">
            ${!isCobrada ? `
              <button onclick="abrirModalCobrarFactura(${f.id})" title="Marcar como Cobrada" class="px-2.5 py-1 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-xs font-semibold transition active:scale-95">
                Cobrar
              </button>
            ` : ''}
            <button onclick="eliminarNegocioFactura(${f.id})" title="Eliminar Factura" class="p-1.5 text-slate-500 hover:text-rose-400 transition">
              <i data-lucide="trash-2" class="w-4 h-4"></i>
            </button>
          </td>
        </tr>
      `;
    }).join('');
  }

  // Render Mobile Cards
  if (mobileContainer) {
    mobileContainer.innerHTML = facturas.map(f => {
      const isCobrada = f.estado === 'cobrado';
      const isVencida = !isCobrada && f.fecha_vencimiento && new Date(f.fecha_vencimiento) < new Date();
      const statusBadge = isCobrada 
        ? '<span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">Cobrado</span>'
        : isVencida
        ? '<span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">Vencida</span>'
        : '<span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">Pendiente</span>';

      return `
        <div class="p-3.5 rounded-xl bg-slate-900 border border-slate-800 space-y-2">
          <div class="flex justify-between items-start">
            <div>
              <span class="text-xs font-bold text-white">${escapeHTML(f.numero_factura || 'Factura')}</span>
              <h5 class="text-xs font-semibold text-slate-300 mt-0.5">${escapeHTML(f.cliente_nombre || 'Cliente')}</h5>
            </div>
            ${statusBadge}
          </div>
          <p class="text-xs text-slate-400 line-clamp-1">${escapeHTML(f.descripcion)}</p>
          <div class="flex justify-between items-center pt-2 border-t border-slate-800 text-xs">
            <span class="font-extrabold text-white text-sm">
              ${f.moneda === 'USD' ? `US$ ${Number(f.monto).toLocaleString('en-US')}` : formatMoney(f.monto)}
            </span>
            <div class="flex items-center gap-1.5">
              ${!isCobrada ? `
                <button onclick="abrirModalCobrarFactura(${f.id})" class="px-2.5 py-1 rounded-lg bg-emerald-500 text-slate-950 font-bold text-xs transition active:scale-95">
                  Cobrar
                </button>
              ` : ''}
              <button onclick="eliminarNegocioFactura(${f.id})" class="p-1 text-slate-500 hover:text-rose-400">
                <i data-lucide="trash-2" class="w-4 h-4"></i>
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }
}

async function loadNegocioProyectos() {
  try {
    const res = await authFetch('/api/negocio/proyectos');
    if (!res.ok) return;
    const data = await res.json();
    currentNegocioProyectosList = Array.isArray(data) ? data : (data.proyectos || []);
    renderNegocioProyectos(currentNegocioProyectosList);
  } catch (err) {
    console.error('Error cargando proyectos comerciales:', err);
  }
}

function renderNegocioProyectos(proyectos) {
  const container = document.getElementById('gridNegocioProyectos');
  if (!container) return;

  if (!proyectos || proyectos.length === 0) {
    container.innerHTML = `
      <div class="col-span-full p-8 text-center bg-slate-900/40 rounded-2xl border border-slate-800 space-y-3">
        <div class="w-12 h-12 rounded-2xl bg-indigo-500/10 text-indigo-400 flex items-center justify-center mx-auto">
          <i data-lucide="layers" class="w-6 h-6"></i>
        </div>
        <div>
          <h5 class="text-sm font-bold text-white">No tienes proyectos creados</h5>
          <p class="text-xs text-slate-400">Registra un proyecto con su monto pactado y costos para medir tu margen de ganancia real.</p>
        </div>
        <button onclick="abrirModalNegocioProyecto()" class="px-3.5 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs transition active:scale-95">
          + Crear Primer Proyecto
        </button>
      </div>
    `;
    return;
  }

  container.innerHTML = proyectos.map(p => {
    const margenColor = p.margen_porcentaje >= 40 ? 'text-emerald-400' : p.margen_porcentaje >= 15 ? 'text-amber-400' : 'text-rose-400';
    return `
      <div class="p-4 sm:p-5 rounded-2xl bg-slate-900/80 border border-slate-800 hover:border-slate-700 transition space-y-3 relative group">
        <div class="flex justify-between items-start">
          <div>
            <span class="text-[10px] font-bold uppercase tracking-wider text-amber-400">${escapeHTML(p.cliente_nombre || 'Cliente General')}</span>
            <h5 class="font-bold text-sm sm:text-base text-white leading-tight mt-0.5">${escapeHTML(p.nombre)}</h5>
          </div>
          <button onclick="eliminarNegocioProyecto(${p.id})" title="Eliminar Proyecto" class="opacity-0 group-hover:opacity-100 p-1 text-slate-500 hover:text-rose-400 transition">
            <i data-lucide="trash-2" class="w-4 h-4"></i>
          </button>
        </div>

        ${p.descripcion ? `<p class="text-xs text-slate-400 line-clamp-2">${escapeHTML(p.descripcion)}</p>` : ''}

        <div class="grid grid-cols-2 gap-2 p-3 rounded-xl bg-slate-950/70 border border-slate-800/80 text-xs">
          <div>
            <span class="text-[10px] text-slate-400 block">Pactado</span>
            <span class="font-bold text-white">${p.moneda === 'USD' ? `US$ ${Number(p.monto_pactado).toLocaleString('en-US')}` : formatMoney(p.monto_pactado)}</span>
          </div>
          <div>
            <span class="text-[10px] text-slate-400 block">Costos Estimados</span>
            <span class="font-semibold text-rose-300">${p.moneda === 'USD' ? `US$ ${Number(p.costos_estimados).toLocaleString('en-US')}` : formatMoney(p.costos_estimados)}</span>
          </div>
        </div>

        <div class="flex justify-between items-center pt-2 border-t border-slate-800/80 text-xs">
          <div>
            <span class="text-[10px] text-slate-400 block">Ganancia Neta</span>
            <span class="font-extrabold ${margenColor}">${p.moneda === 'USD' ? `US$ ${Number(p.ganancia_neta).toLocaleString('en-US')}` : formatMoney(p.ganancia_neta)}</span>
          </div>
          <div class="text-right">
            <span class="text-[10px] text-slate-400 block">Margen Neto</span>
            <span class="px-2 py-0.5 rounded-full bg-slate-800 font-bold ${margenColor} border border-slate-700/60">${p.margen_porcentaje}%</span>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

async function loadNegocioMonotributo() {
  try {
    const res = await authFetch('/api/negocio/monotributo');
    if (!res.ok) return;
    const data = await res.json();
    currentNegocioMonotributoConfig = data.config;

    // Render Tab 3: Monitor Monotributo
    const elActividad = document.getElementById('monotributoLabelActividad');
    const elCat = document.getElementById('monotributoLabelCatActual');
    const elPct = document.getElementById('monotributoBadgePct');
    const elBar = document.getElementById('monotributoBarGrande');
    const elFacturado = document.getElementById('monotributoValorFacturado');
    const elTope = document.getElementById('monotributoValorTope');
    const elRestante = document.getElementById('monotributoValorRestante');
    const elAlerta = document.getElementById('monotributoTextoAlerta');

    if (elActividad) elActividad.textContent = data.config?.tipo_actividad === 'bienes' ? 'Venta de Bienes' : 'Locación y Prestación de Servicios';
    if (elCat) elCat.textContent = `Categoría ${data.config?.categoria_monotributo || 'E'}`;
    if (elPct) elPct.textContent = `${data.porcentajeConsumido}% del tope anual`;
    if (elBar) elBar.style.width = `${Math.min(100, data.porcentajeConsumido)}%`;
    if (elFacturado) elFacturado.textContent = formatMoney(data.facturado12Meses);
    if (elTope) elTope.textContent = formatMoney(data.limiteAnual);
    if (elRestante) elRestante.textContent = formatMoney(data.margenRestante);

    if (elAlerta) {
      if (data.porcentajeConsumido >= 90) {
        elAlerta.innerHTML = `<span class="text-rose-400 font-bold">¡ALERTA CRÍTICA!</span> Has consumido el <strong>${data.porcentajeConsumido}%</strong> del tope anual. En la próxima recategorización semestral subirás de categoría o quedarás en exclusión al régimen general si superas la categoría K.`;
      } else if (data.porcentajeConsumido >= 70) {
        elAlerta.innerHTML = `<span class="text-amber-300 font-semibold">Zona de Precaución:</span> Llevas el <strong>${data.porcentajeConsumido}%</strong> de tu escala anual consumido. Planifica tus próximas facturaciones para no dar saltos bruscos.`;
      } else {
        elAlerta.innerHTML = `Estás operando en una zona segura (<strong>${data.porcentajeConsumido}%</strong> del tope). Dispones de ${formatMoney(data.margenRestante)} de cupo antes de alcanzar el límite de tu categoría.`;
      }
    }

    // Render Escalas Anuales Oficiales
    const gridEscalas = document.getElementById('gridEscalasMonotributo');
    if (gridEscalas && data.escalas) {
      const cats = Object.keys(data.escalas);
      gridEscalas.innerHTML = cats.map(catKey => {
        const isCurrent = (data.config?.categoria_monotributo || '').toUpperCase() === catKey;
        const tope = data.escalas[catKey];
        return `
          <div class="p-2.5 rounded-xl text-center border ${isCurrent ? 'bg-amber-500/10 border-amber-500 text-amber-300 font-bold ring-1 ring-amber-500/40' : 'bg-slate-950/60 border-slate-800 text-slate-400'}">
            <span class="text-xs uppercase block ${isCurrent ? 'text-amber-400' : 'text-slate-300'} font-bold">Cat. ${catKey}</span>
            <span class="text-[11px] block mt-0.5">${formatMoney(tope)}</span>
          </div>
        `;
      }).join('');
    }

  } catch (err) {
    console.error('Error cargando monitor monotributo:', err);
  }
}

// Handlers de Modales de Negocios
function abrirModalNegocioCliente() {
  const form = document.getElementById('formNegocioCliente');
  if (form) form.reset();
  openModal('modalNegocioCliente');
}

async function handleCrearNegocioCliente(e) {
  e.preventDefault();
  const form = e.target;
  const formData = new FormData(form);
  const payload = Object.fromEntries(formData.entries());

  try {
    const res = await authFetch('/api/negocio/clientes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      showToast('Cliente guardado exitosamente');
      closeModal('modalNegocioCliente');
      form.reset();
      await loadNegocioClientes();
    } else {
      const err = await res.json();
      showToast(err.error || 'Error al guardar cliente', 'error');
    }
  } catch (err) {
    showToast('Error de conexión', 'error');
  }
}

async function eliminarNegocioCliente(id) {
  if (!confirm('¿Eliminar este cliente? Se mantendrán las facturas históricas asociadas.')) return;
  try {
    const res = await authFetch(`/api/negocio/clientes/${id}`, { method: 'DELETE' });
    if (res.ok) {
      showToast('Cliente eliminado');
      await loadNegocioClientes();
    }
  } catch (err) {
    showToast('Error al eliminar cliente', 'error');
  }
}

function abrirModalNegocioFactura(clienteId = null) {
  const form = document.getElementById('formNegocioFactura');
  if (form) form.reset();

  const today = new Date().toISOString().substring(0, 10);
  const in30Days = new Date(Date.now() + 30 * 86400000).toISOString().substring(0, 10);

  const inputEmision = document.getElementById('inputFacturaFechaEmision');
  const inputVencimiento = document.getElementById('inputFacturaFechaVencimiento');
  if (inputEmision) inputEmision.value = today;
  if (inputVencimiento) inputVencimiento.value = in30Days;

  poblarSelectsClientes(currentNegocioClientesList);
  if (clienteId) {
    const select = document.getElementById('selectFacturaCliente');
    if (select) select.value = clienteId;
  }

  openModal('modalNegocioFactura');
}

async function handleCrearNegocioFactura(e) {
  e.preventDefault();
  const form = e.target;
  const formData = new FormData(form);
  const payload = Object.fromEntries(formData.entries());

  try {
    const res = await authFetch('/api/negocio/facturas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      showToast('Factura registrada correctamente');
      closeModal('modalNegocioFactura');
      form.reset();
      await Promise.all([loadNegocioFacturas(), loadNegocioResumen(), loadNegocioMonotributo()]);
    } else {
      const err = await res.json();
      showToast(err.error || 'Error al registrar factura', 'error');
    }
  } catch (err) {
    showToast('Error de conexión', 'error');
  }
}

function abrirModalCobrarFactura(facturaId) {
  const factura = currentNegocioFacturasList.find(f => f.id === facturaId);
  if (!factura) return;

  const idInput = document.getElementById('cobrarFacturaId');
  const clienteEl = document.getElementById('cobrarFacturaCliente');
  const conceptoEl = document.getElementById('cobrarFacturaConcepto');
  const montoEl = document.getElementById('cobrarFacturaMonto');
  const fechaInput = document.getElementById('cobrarFacturaFecha');
  const selectCuenta = document.getElementById('cobrarFacturaCuentaId');

  if (idInput) idInput.value = factura.id;
  if (clienteEl) clienteEl.textContent = `${factura.cliente_nombre || 'Cliente'} ${factura.cliente_empresa ? `(${factura.cliente_empresa})` : ''}`;
  if (conceptoEl) conceptoEl.textContent = `${factura.numero_factura ? `[${factura.numero_factura}] ` : ''}${factura.descripcion}`;
  if (montoEl) montoEl.textContent = factura.moneda === 'USD' ? `US$ ${Number(factura.monto).toLocaleString('en-US')}` : formatMoney(factura.monto);
  if (fechaInput) fechaInput.value = new Date().toISOString().substring(0, 10);

  // Poblar opciones de cuentas bancarias
  if (selectCuenta) {
    let opts = '<option value="">No acreditar en cuenta bancaria (Solo marcar cobrada)</option>';
    currentCuentasList.forEach(c => {
      opts += `<option value="${c.id}">${escapeHTML(c.nombre)} (${escapeHTML(c.banco || 'Banco')} - Saldo: ${formatMoney(c.saldo)})</option>`;
    });
    selectCuenta.innerHTML = opts;
  }

  openModal('modalNegocioCobrarFactura');
}

async function handleConfirmarCobroFactura(e) {
  e.preventDefault();
  const id = document.getElementById('cobrarFacturaId')?.value;
  const fecha_cobro = document.getElementById('cobrarFacturaFecha')?.value;
  const cuenta_id = document.getElementById('cobrarFacturaCuentaId')?.value || null;

  if (!id) return;

  try {
    const res = await authFetch(`/api/negocio/facturas/${id}/cobrar`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fecha_cobro, cuenta_id })
    });

    if (res.ok) {
      showToast('¡Cobro registrado con éxito!');
      closeModal('modalNegocioCobrarFactura');
      await Promise.all([
        loadNegocioFacturas(),
        loadNegocioResumen(),
        loadNegocioMonotributo(),
        loadCuentas() // si se acreditó en banco
      ]);
    } else {
      const err = await res.json();
      showToast(err.error || 'Error al registrar cobro', 'error');
    }
  } catch (err) {
    showToast('Error al confirmar cobro', 'error');
  }
}

async function eliminarNegocioFactura(id) {
  if (!confirm('¿Seguro que deseas eliminar esta factura comercial?')) return;
  try {
    const res = await authFetch(`/api/negocio/facturas/${id}`, { method: 'DELETE' });
    if (res.ok) {
      showToast('Factura eliminada');
      await Promise.all([loadNegocioFacturas(), loadNegocioResumen(), loadNegocioMonotributo()]);
    }
  } catch (err) {
    showToast('Error al eliminar factura', 'error');
  }
}

function abrirModalNegocioProyecto() {
  const form = document.getElementById('formNegocioProyecto');
  if (form) form.reset();
  poblarSelectsClientes(currentNegocioClientesList);
  openModal('modalNegocioProyecto');
}

async function handleCrearNegocioProyecto(e) {
  e.preventDefault();
  const form = e.target;
  const formData = new FormData(form);
  const payload = Object.fromEntries(formData.entries());

  try {
    const res = await authFetch('/api/negocio/proyectos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      showToast('Proyecto creado exitosamente');
      closeModal('modalNegocioProyecto');
      form.reset();
      await loadNegocioProyectos();
    } else {
      const err = await res.json();
      showToast(err.error || 'Error al crear proyecto', 'error');
    }
  } catch (err) {
    showToast('Error de conexión', 'error');
  }
}

async function eliminarNegocioProyecto(id) {
  if (!confirm('¿Eliminar este proyecto?')) return;
  try {
    const res = await authFetch(`/api/negocio/proyectos/${id}`, { method: 'DELETE' });
    if (res.ok) {
      showToast('Proyecto eliminado');
      await loadNegocioProyectos();
    }
  } catch (err) {
    showToast('Error al eliminar proyecto', 'error');
  }
}

function abrirModalConfigMonotributo() {
  if (currentNegocioMonotributoConfig) {
    const catSelect = document.getElementById('configCategoriaMonotributo');
    const actSelect = document.getElementById('configTipoActividad');
    const sueldoInput = document.getElementById('configSueldoDueno');

    if (catSelect) catSelect.value = currentNegocioMonotributoConfig.categoria_monotributo || 'E';
    if (actSelect) actSelect.value = currentNegocioMonotributoConfig.tipo_actividad || 'servicios';
    if (sueldoInput) sueldoInput.value = currentNegocioMonotributoConfig.sueldo_dueno_objetivo || '';
  }
  openModal('modalNegocioConfigMonotributo');
}

async function handleGuardarConfigMonotributo(e) {
  e.preventDefault();
  const categoria_monotributo = document.getElementById('configCategoriaMonotributo')?.value;
  const tipo_actividad = document.getElementById('configTipoActividad')?.value;
  const sueldo_dueno_objetivo = document.getElementById('configSueldoDueno')?.value || 0;

  try {
    const res = await authFetch('/api/negocio/monotributo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ categoria_monotributo, tipo_actividad, sueldo_dueno_objetivo })
    });

    if (res.ok) {
      showToast('Configuración del Monotributo actualizada');
      closeModal('modalNegocioConfigMonotributo');
      await Promise.all([loadNegocioMonotributo(), loadNegocioResumen()]);
    } else {
      showToast('Error al actualizar configuración', 'error');
    }
  } catch (err) {
    showToast('Error de conexión', 'error');
  }
}

// Copiloto IA Negocios: Cotización & Cobranza
async function handleGenerarCotizacionIA(e) {
  e.preventDefault();
  const cliente = document.getElementById('cotizarCliente')?.value;
  const proyecto = document.getElementById('cotizarProyecto')?.value;
  const horas_estimadas = document.getElementById('cotizarHoras')?.value;
  const tarifa_hora = document.getElementById('cotizarTarifa')?.value;
  const moneda = document.getElementById('cotizarMoneda')?.value;
  const entregables = document.getElementById('cotizarEntregables')?.value;

  const btnSubmit = document.getElementById('btnSubmitCotizar');
  const boxResultado = document.getElementById('boxResultadoCotizacion');
  const textoResultado = document.getElementById('resultadoCotizacionTexto');

  if (btnSubmit) {
    btnSubmit.disabled = true;
    btnSubmit.innerHTML = '<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i><span>Redactando propuesta comercial con IA...</span>';
    if (window.lucide) lucide.createIcons();
  }

  try {
    const res = await authFetch('/api/agente/negocio/cotizar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cliente, proyecto, horas_estimadas, tarifa_hora, moneda, entregables })
    });

    const data = await res.json();
    if (boxResultado) boxResultado.classList.remove('hidden');
    if (textoResultado) textoResultado.textContent = data.propuesta || 'Propuesta generada.';
    showToast('Propuesta comercial generada con éxito');
  } catch (err) {
    showToast('Error generando propuesta con IA', 'error');
  } finally {
    if (btnSubmit) {
      btnSubmit.disabled = false;
      btnSubmit.innerHTML = '<i data-lucide="sparkles" class="w-4 h-4"></i><span>Generar Propuesta con IA</span>';
      if (window.lucide) lucide.createIcons();
    }
  }
}

function copiarPropuestaCotizacion() {
  const texto = document.getElementById('resultadoCotizacionTexto')?.textContent;
  if (!texto) return;
  navigator.clipboard.writeText(texto).then(() => {
    showToast('Propuesta copiada al portapapeles');
  });
}

async function handleGenerarCobranzaIA(e) {
  e.preventDefault();
  const cliente = document.getElementById('cobranzaCliente')?.value;
  const numero_factura = document.getElementById('cobranzaNumeroFactura')?.value;
  const monto = document.getElementById('cobranzaMonto')?.value;
  const dias_vencido = document.getElementById('cobranzaDias')?.value;
  const canal = document.getElementById('cobranzaCanal')?.value;

  const btnSubmit = document.getElementById('btnSubmitCobranza');
  const boxResultado = document.getElementById('boxResultadoCobranza');
  const textoResultado = document.getElementById('resultadoCobranzaTexto');

  if (btnSubmit) {
    btnSubmit.disabled = true;
    btnSubmit.innerHTML = '<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i><span>Redactando mensaje con IA...</span>';
    if (window.lucide) lucide.createIcons();
  }

  try {
    const res = await authFetch('/api/agente/negocio/cobranza', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cliente, numero_factura, monto, dias_vencido, canal })
    });

    const data = await res.json();
    if (boxResultado) boxResultado.classList.remove('hidden');
    if (textoResultado) textoResultado.textContent = data.mensaje || 'Mensaje de cobro redactado.';
    showToast('Recordatorio de cobro generado');
  } catch (err) {
    showToast('Error generando mensaje con IA', 'error');
  } finally {
    if (btnSubmit) {
      btnSubmit.disabled = false;
      btnSubmit.innerHTML = '<i data-lucide="send" class="w-4 h-4"></i><span>Redactar Recordatorio de Cobro</span>';
      if (window.lucide) lucide.createIcons();
    }
  }
}

function copiarMensajeCobranza() {
  const texto = document.getElementById('resultadoCobranzaTexto')?.textContent;
  if (!texto) return;
  navigator.clipboard.writeText(texto).then(() => {
    showToast('Mensaje de cobranza copiado');
  });
}

// ==========================================
// MÉTRICA CONTADOR PARTNER B2B (CONDICIÓN 2 TERM SHEET)
// ==========================================

async function loadContadorData() {
  await Promise.allSettled([
    loadContadorResumen(),
    loadContadorClientes()
  ]);
  if (window.lucide) lucide.createIcons();
}

async function loadContadorResumen() {
  try {
    const res = await authFetch('/api/contador/resumen');
    if (!res.ok) return;
    const data = await res.json();

    const elTotal = document.getElementById('kpiContadorTotalClientes');
    const elFact = document.getElementById('kpiContadorFacturacionGlobal');
    const elCrit = document.getElementById('kpiContadorClientesCriticos');
    const elPrec = document.getElementById('kpiContadorClientesPrecaucion');

    if (elTotal) elTotal.textContent = data.totalClientes || 0;
    if (elFact) elFact.textContent = formatMoney(data.facturacionGlobal12M || 0);
    if (elCrit) elCrit.textContent = data.clientesCriticos || 0;
    if (elPrec) elPrec.textContent = data.clientesPrecaucion || 0;

    const elSubCrit = document.getElementById('kpiContadorRiesgoExclusionTexto');
    if (elSubCrit) {
      if (data.clientesRiesgoExclusion > 0) {
        elSubCrit.textContent = `⚠️ ${data.clientesRiesgoExclusion} en riesgo de Régimen General`;
      } else {
        elSubCrit.textContent = 'Peligro de salto o exclusión';
      }
    }
  } catch (err) {
    console.error('Error cargando resumen de contador:', err);
  }
}

async function loadContadorClientes() {
  try {
    const res = await authFetch('/api/contador/clientes');
    if (!res.ok) return;
    const data = await res.json();
    currentContadorClientesList = data.clientes || [];
    renderContadorClientes(currentContadorClientesList);
    actualizarContadoresFiltro(currentContadorClientesList);
  } catch (err) {
    console.error('Error cargando clientes de contador:', err);
  }
}

function actualizarContadoresFiltro(clientes) {
  const cTodos = clientes.length;
  const cCriticos = clientes.filter(c => c.estadoAlerta === 'critico').length;
  const cPrecaucion = clientes.filter(c => c.estadoAlerta === 'precaucion').length;
  const cSeguros = clientes.filter(c => c.estadoAlerta === 'seguro').length;

  const elTodos = document.getElementById('countFilterTodos');
  const elCrit = document.getElementById('countFilterCriticos');
  const elPrec = document.getElementById('countFilterPrecaucion');
  const elSeg = document.getElementById('countFilterSeguros');

  if (elTodos) elTodos.textContent = cTodos;
  if (elCrit) elCrit.textContent = cCriticos;
  if (elPrec) elPrec.textContent = cPrecaucion;
  if (elSeg) elSeg.textContent = cSeguros;
}

function filtrarContadorClientes(filtro) {
  currentContadorFiltro = filtro;
  const filtros = ['todos', 'criticos', 'precaucion', 'seguros'];
  filtros.forEach(f => {
    const btn = document.getElementById(`filterBtnContador-${f}`);
    if (btn) {
      if (f === filtro) {
        btn.className = 'px-2.5 py-1 rounded-lg bg-cyan-500 text-slate-950 font-bold transition';
      } else {
        btn.className = 'px-2.5 py-1 rounded-lg text-slate-400 hover:text-white transition';
      }
    }
  });

  let filtrados = currentContadorClientesList;
  if (filtro === 'criticos') filtrados = currentContadorClientesList.filter(c => c.estadoAlerta === 'critico');
  if (filtro === 'precaucion') filtrados = currentContadorClientesList.filter(c => c.estadoAlerta === 'precaucion');
  if (filtro === 'seguros') filtrados = currentContadorClientesList.filter(c => c.estadoAlerta === 'seguro');

  renderContadorClientes(filtrados);
}

function renderContadorClientes(clientes) {
  const tbody = document.getElementById('tablaContadorClientesBody');
  const mobileContainer = document.getElementById('listaContadorClientesMobile');

  if (!clientes || clientes.length === 0) {
    const emptyHtml = `
      <div class="p-8 text-center bg-slate-900/40 rounded-2xl border border-slate-800 space-y-2">
        <div class="w-10 h-10 rounded-xl bg-cyan-500/10 text-cyan-400 flex items-center justify-center mx-auto">
          <i data-lucide="users" class="w-5 h-5"></i>
        </div>
        <p class="text-xs text-slate-400">No hay contribuyentes para este filtro de búsqueda.</p>
      </div>`;
    if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="py-8 text-center text-slate-500">No hay contribuyentes registrados.</td></tr>`;
    if (mobileContainer) mobileContainer.innerHTML = emptyHtml;
    return;
  }

  // Render Desktop
  if (tbody) {
    tbody.innerHTML = clientes.map(c => {
      const isCritico = c.estadoAlerta === 'critico';
      const isPrecaucion = c.estadoAlerta === 'precaucion';

      const badgeColor = isCritico ? 'bg-rose-500/10 border-rose-500/30 text-rose-400' : isPrecaucion ? 'bg-amber-500/10 border-amber-500/30 text-amber-300' : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400';
      const barColor = isCritico ? 'bg-rose-500' : isPrecaucion ? 'bg-amber-500' : 'bg-emerald-500';

      return `
        <tr class="hover:bg-slate-800/40 transition">
          <td class="py-3 px-3">
            <div class="font-bold text-white text-xs">${escapeHTML(c.nombre_titular)}</div>
            <div class="text-[11px] text-slate-400 flex items-center gap-1.5 mt-0.5">
              <span>CUIT: ${escapeHTML(c.cuit)}</span>
              ${c.telefono ? `<span class="text-slate-600">|</span> <span>${escapeHTML(c.telefono)}</span>` : ''}
            </div>
          </td>
          <td class="py-3 px-3">
            <span class="inline-block px-2 py-0.5 rounded font-bold text-[11px] bg-slate-800 text-slate-200 border border-slate-700">
              Cat. ${escapeHTML(c.categoria_monotributo)}
            </span>
            <div class="text-[10px] text-slate-400 mt-0.5 capitalize">${escapeHTML(c.tipo_actividad)}</div>
          </td>
          <td class="py-3 px-3">
            <div class="font-semibold text-white text-xs">${formatMoney(c.facturacion_acumulada_12m)}</div>
            <div class="text-[10px] text-slate-500">Tope: ${formatMoney(c.topeCategoria)}</div>
          </td>
          <td class="py-3 px-3 min-w-[140px]">
            <div class="flex justify-between items-center text-[10px] font-bold mb-1">
              <span class="${isCritico ? 'text-rose-400' : isPrecaucion ? 'text-amber-400' : 'text-emerald-400'}">${c.porcentajeConsumido}% consumido</span>
            </div>
            <div class="w-full bg-slate-950 rounded-full h-2 overflow-hidden border border-slate-800">
              <div class="h-full rounded-full ${barColor}" style="width: ${c.porcentajeConsumido}%"></div>
            </div>
          </td>
          <td class="py-3 px-3">
            <div class="font-semibold ${isCritico ? 'text-rose-400' : 'text-slate-200'} text-xs">${formatMoney(c.margenRestante)}</div>
            <div class="text-[10px] text-slate-500">cupo disponible</div>
          </td>
          <td class="py-3 px-3">
            <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${badgeColor}">
              <span class="w-1.5 h-1.5 rounded-full ${barColor}"></span>
              ${escapeHTML(c.proyeccion)}
            </span>
          </td>
          <td class="py-3 px-3 text-right">
            <div class="flex items-center justify-end gap-1.5">
              ${c.telefono ? `
                <button type="button" onclick="notificarClienteWhatsApp('${encodeURIComponent(c.nombre_titular)}', '${encodeURIComponent(c.telefono)}', '${c.categoria_monotributo}', ${c.porcentajeConsumido}, ${c.margenRestante})" title="Enviar Alerta Preventiva por WhatsApp" class="p-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 transition active:scale-95">
                  <i data-lucide="message-circle" class="w-3.5 h-3.5"></i>
                </button>
              ` : ''}
              <button type="button" onclick="eliminarContadorCliente(${c.id})" title="Eliminar del estudio" class="p-1.5 text-slate-500 hover:text-rose-400 rounded-lg hover:bg-slate-800 transition">
                <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  // Render Mobile Cards
  if (mobileContainer) {
    mobileContainer.innerHTML = clientes.map(c => {
      const isCritico = c.estadoAlerta === 'critico';
      const isPrecaucion = c.estadoAlerta === 'precaucion';
      const badgeColor = isCritico ? 'bg-rose-500/10 border-rose-500/30 text-rose-400' : isPrecaucion ? 'bg-amber-500/10 border-amber-500/30 text-amber-300' : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400';
      const barColor = isCritico ? 'bg-rose-500' : isPrecaucion ? 'bg-amber-500' : 'bg-emerald-500';

      return `
        <div class="p-4 rounded-xl bg-slate-900/80 border border-slate-800 space-y-2.5">
          <div class="flex justify-between items-start">
            <div>
              <h5 class="font-bold text-white text-xs">${escapeHTML(c.nombre_titular)}</h5>
              <p class="text-[11px] text-slate-400">CUIT: ${escapeHTML(c.cuit)}</p>
            </div>
            <span class="px-2 py-0.5 rounded font-bold text-[10px] bg-slate-800 text-slate-200 border border-slate-700">
              Cat. ${escapeHTML(c.categoria_monotributo)}
            </span>
          </div>

          <div class="space-y-1">
            <div class="flex justify-between text-[11px]">
              <span class="text-slate-400">Facturado: <strong class="text-white">${formatMoney(c.facturacion_acumulada_12m)}</strong></span>
              <span class="font-bold ${isCritico ? 'text-rose-400' : isPrecaucion ? 'text-amber-400' : 'text-emerald-400'}">${c.porcentajeConsumido}%</span>
            </div>
            <div class="w-full bg-slate-950 rounded-full h-1.5 overflow-hidden border border-slate-800">
              <div class="h-full rounded-full ${barColor}" style="width: ${c.porcentajeConsumido}%"></div>
            </div>
          </div>

          <div class="flex items-center justify-between text-[11px] pt-1">
            <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${badgeColor}">
              ${escapeHTML(c.proyeccion)}
            </span>
            <div class="flex items-center gap-1">
              ${c.telefono ? `
                <button type="button" onclick="notificarClienteWhatsApp('${encodeURIComponent(c.nombre_titular)}', '${encodeURIComponent(c.telefono)}', '${c.categoria_monotributo}', ${c.porcentajeConsumido}, ${c.margenRestante})" class="px-2 py-1 rounded bg-emerald-500/20 text-emerald-300 text-[10px] font-bold">
                  WhatsApp
                </button>
              ` : ''}
              <button type="button" onclick="eliminarContadorCliente(${c.id})" class="p-1 text-slate-500 hover:text-rose-400">
                <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  if (window.lucide) lucide.createIcons();
}

function notificarClienteWhatsApp(nombreEnc, telefonoEnc, cat, pct, margen) {
  const nombre = decodeURIComponent(nombreEnc);
  const telLimpio = decodeURIComponent(telefonoEnc).replace(/[^0-9]/g, '');
  const mensaje = `Hola ${nombre}, te contacto desde el estudio contable. Te informamos que tu facturación de Monotributo Cat. ${cat} ha alcanzado el ${pct}% del tope anual. Te restan ${formatMoney(margen)} disponibles antes de la próxima recategorización. Te recomendamos coordinar tus próximas facturas para no generar saltos de escala. Saludos!`;
  const url = `https://wa.me/${telLimpio}?text=${encodeURIComponent(mensaje)}`;
  window.open(url, '_blank');
}

function abrirModalContadorCliente() {
  const form = document.getElementById('formContadorCliente');
  if (form) form.reset();
  openModal('modalContadorCliente');
}

async function handleGuardarContadorCliente(e) {
  e.preventDefault();
  const nombre_titular = document.getElementById('contadorClienteNombre')?.value;
  const cuit = document.getElementById('contadorClienteCuit')?.value;
  const categoria_monotributo = document.getElementById('contadorClienteCategoria')?.value;
  const tipo_actividad = document.getElementById('contadorClienteActividad')?.value;
  const facturacion_acumulada_12m = document.getElementById('contadorClienteFacturacion')?.value;
  const email_contacto = document.getElementById('contadorClienteEmail')?.value;
  const telefono = document.getElementById('contadorClienteTelefono')?.value;
  const notas = document.getElementById('contadorClienteNotas')?.value;

  try {
    const res = await authFetch('/api/contador/clientes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nombre_titular, cuit, categoria_monotributo, tipo_actividad,
        facturacion_acumulada_12m, email_contacto, telefono, notas
      })
    });

    if (res.ok) {
      showToast('Contribuyente registrado en el estudio');
      closeModal('modalContadorCliente');
      await loadContadorData();
    } else {
      const err = await res.json();
      showToast(err.error || 'Error al guardar cliente', 'error');
    }
  } catch (err) {
    showToast('Error de conexión', 'error');
  }
}

async function eliminarContadorCliente(id) {
  if (!confirm('¿Deseas dar de baja a este contribuyente del panel del estudio?')) return;
  try {
    const res = await authFetch(`/api/contador/clientes/${id}`, { method: 'DELETE' });
    if (res.ok) {
      showToast('Contribuyente eliminado del panel');
      await loadContadorData();
    }
  } catch (err) {
    showToast('Error al eliminar contribuyente', 'error');
  }
}

function exportarReporteContador() {
  window.open(`${API_BASE}/contador/exportar?token=${authToken || ''}`, '_blank');
  showToast('Generando y descargando reporte AFIP...');
}

function abrirModalContadorInvitar() {
  openModal('modalContadorInvitar');
}

function copiarLinkInvitacion() {
  const txt = document.getElementById('textoLinkInvitacion')?.textContent?.trim();
  if (txt) {
    navigator.clipboard.writeText(txt).then(() => {
      showToast('Enlace de invitación copiado al portapapeles');
    });
  }
}

function enviarInvitacionWhatsApp() {
  const txt = document.getElementById('textoLinkInvitacion')?.textContent?.trim();
  const mensaje = `Hola! Para sincronizar tus facturas y gastos con nuestro estudio contable y monitorear tu escala de Monotributo en tiempo real, ingresa en el siguiente enlace de Métrica: ${txt}`;
  window.open(`https://wa.me/?text=${encodeURIComponent(mensaje)}`, '_blank');
}

// ==========================================
// PRICING DINÁMICO BIMONETARIO (CONDICIÓN 1)
// ==========================================

async function abrirModalPricing() {
  openModal('modalPricing');
  try {
    const res = await fetch('/api/pricing');
    if (!res.ok) return;
    const data = await res.json();
    cachedPricingData = data;

    const elMep = document.getElementById('pricingMepValor');
    if (elMep) elMep.textContent = `$ ${Math.round(data.tipoCambioMEP).toLocaleString('es-AR')} ARS`;

    renderPricingCards(data.planes, data.tipoCambioMEP);
  } catch (err) {
    console.error('Error cargando planes de pricing:', err);
  }
}

function setPricingPeriodo(periodo) {
  currentPricingPeriodo = periodo;
  const btnM = document.getElementById('btnPricingPeriodoMensual');
  const btnA = document.getElementById('btnPricingPeriodoAnual');

  if (periodo === 'anual') {
    if (btnA) btnA.className = 'px-3 py-1 rounded-lg bg-emerald-500 text-slate-950 font-bold transition flex items-center gap-1.5';
    if (btnM) btnM.className = 'px-3 py-1 rounded-lg text-slate-400 hover:text-white transition';
  } else {
    if (btnM) btnM.className = 'px-3 py-1 rounded-lg bg-emerald-500 text-slate-950 font-bold transition';
    if (btnA) btnA.className = 'px-3 py-1 rounded-lg text-slate-400 hover:text-white transition flex items-center gap-1.5';
  }

  if (cachedPricingData) {
    renderPricingCards(cachedPricingData.planes, cachedPricingData.tipoCambioMEP);
  }
}

function renderPricingCards(planes, mep) {
  const container = document.getElementById('gridPricingCards');
  if (!container || !planes) return;

  const userPlan = currentUser?.plan_suscripcion || 'free';

  container.innerHTML = planes.map(p => {
    const isAnual = currentPricingPeriodo === 'anual';
    const mult = isAnual ? 0.8 : 1.0;
    const precioUsd = p.precioUSD === 0 ? 0 : (p.precioUSD * mult);
    const precioArs = p.precioUSD === 0 ? 0 : Math.round(precioUsd * mep);

    const isCurrent = userPlan === p.id || (p.id === 'starter' && userPlan === 'free');
    const isPartner = p.id === 'contador_partner';
    const isNegocio = p.id === 'pro_negocios';

    const borderColor = isCurrent ? 'border-emerald-500 ring-2 ring-emerald-500/30' : isPartner ? 'border-cyan-500/50 hover:border-cyan-400' : isNegocio ? 'border-amber-500/50 hover:border-amber-400' : 'border-slate-800 hover:border-slate-700';

    return `
      <div class="rounded-2xl p-5 bg-slate-950/70 border ${borderColor} flex flex-col justify-between space-y-4 relative group transition">
        <div class="space-y-3">
          <div class="flex justify-between items-start">
            <span class="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${isPartner ? 'bg-cyan-500/20 text-cyan-300' : isNegocio ? 'bg-amber-500/20 text-amber-300' : 'bg-emerald-500/20 text-emerald-400'}">
              ${escapeHTML(p.badge)}
            </span>
            ${isCurrent ? '<span class="text-[9px] font-extrabold uppercase px-2 py-0.5 rounded-full bg-emerald-500 text-slate-950">Plan Activo</span>' : ''}
          </div>

          <div>
            <h4 class="font-bold text-base text-white">${escapeHTML(p.nombre)}</h4>
            <p class="text-[11px] text-slate-400 mt-1 leading-snug">${escapeHTML(p.descripcion)}</p>
          </div>

          <div class="pt-2 border-t border-slate-800/80">
            <div class="flex items-baseline gap-1">
              <span class="text-2xl font-black text-white">${precioUsd === 0 ? 'Gratis' : `US$ ${precioUsd.toFixed(2)}`}</span>
              ${precioUsd > 0 ? '<span class="text-[11px] text-slate-400">/ mes</span>' : ''}
            </div>
            ${precioArs > 0 ? `
              <div class="text-xs font-semibold text-emerald-400 mt-0.5">
                ≈ $ ${precioArs.toLocaleString('es-AR')} ARS <span class="text-[10px] text-slate-500 font-normal">(MEP)</span>
              </div>
            ` : '<div class="text-xs font-medium text-slate-500 mt-0.5">Sin cargo para siempre</div>'}
          </div>

          <ul class="space-y-2 pt-2 border-t border-slate-800/80 text-xs text-slate-300">
            ${p.caracteristicas.map(c => `
              <li class="flex items-start gap-1.5">
                <i data-lucide="check" class="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5"></i>
                <span class="text-[11px] leading-tight">${escapeHTML(c)}</span>
              </li>
            `).join('')}
          </ul>
        </div>

        <div class="pt-3">
          ${isCurrent ? `
            <button disabled class="w-full py-2 rounded-xl bg-slate-800 text-slate-400 text-xs font-bold cursor-default border border-slate-700">
              Plan Actual
            </button>
          ` : `
            <button onclick="handleContratarPlan('${p.id}')" class="w-full py-2.5 rounded-xl ${isPartner ? 'bg-cyan-500 hover:bg-cyan-400 text-slate-950' : isNegocio ? 'bg-amber-500 hover:bg-amber-400 text-slate-950' : 'bg-emerald-500 hover:bg-emerald-400 text-slate-950'} font-bold text-xs transition active:scale-95 shadow-md">
              Activar ${escapeHTML(p.nombre)}
            </button>
          `}
        </div>
      </div>
    `;
  }).join('');

  if (window.lucide) lucide.createIcons();
}

async function handleContratarPlan(planId) {
  if (!authToken) {
    closeModal('modalPricing');
    openModal('modalAuth');
    showToast('Inicia sesión para suscribirte a un plan', 'error');
    return;
  }

  // Si es el plan gratuito
  if (planId === 'starter' || planId === 'free') {
    try {
      const res = await authFetch('/api/subscription/upgrade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: 'free' })
      });
      const data = await res.json();
      if (res.ok) {
        if (currentUser) currentUser.plan_suscripcion = 'free';
        updateAuthUI(currentUser);
        closeModal('modalPricing');
        showToast('Plan gratuito activo');
      }
    } catch (e) {
      showToast('Error al cambiar a plan gratuito', 'error');
    }
    return;
  }

  // Planes de pago con Mercado Pago
  showToast('Conectando con Mercado Pago...', 'info');
  try {
    const res = await authFetch('/api/mercadopago/crear-checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        planId: planId,
        periodo: currentPricingPeriodo || 'mensual'
      })
    });

    const data = await res.json();

    if (!res.ok) {
      showToast(data.error || 'Error al conectar con Mercado Pago', 'error');
      return;
    }

    // Si es Administrador
    if (data.admin) {
      closeModal('modalPricing');
      showToast(data.mensaje);
      return;
    }

    // Modo simulación local (cuando aún no se configuró el MP_ACCESS_TOKEN)
    if (data.modo_simulacion) {
      if (data.user && currentUser) {
        currentUser.plan_suscripcion = data.user.plan_suscripcion;
        updateAuthUI(currentUser);
      }
      closeModal('modalPricing');
      showToast(data.mensaje);
      if (planId === 'contador_partner') switchWorkspaceMode('contador');
      if (planId === 'pro_negocios') switchWorkspaceMode('negocios');
      return;
    }

    // Redirección oficial al Checkout de Mercado Pago
    if (data.init_point) {
      closeModal('modalPricing');
      showToast('Redirigiendo a Mercado Pago para confirmar tu suscripción...', 'info');
      setTimeout(() => {
        window.location.href = data.init_point;
      }, 800);
    } else {
      showToast('No se pudo generar el enlace de pago', 'error');
    }

  } catch (err) {
    console.error('Error al iniciar checkout Mercado Pago:', err);
    showToast('Error de conexión con la pasarela de pagos', 'error');
  }
}

function verificarRetornoMercadoPago() {
  const urlParams = new URLSearchParams(window.location.search);
  const mpStatus = urlParams.get('mp_status');
  const plan = urlParams.get('plan');
  if (mpStatus === 'approved') {
    showToast(`🎉 ¡Pago confirmado en Mercado Pago! Tu plan ${plan ? plan.toUpperCase().replace('_', ' ') : ''} se ha activado con éxito.`);
    window.history.replaceState({}, document.title, window.location.pathname);
  } else if (mpStatus === 'failure') {
    showToast('El pago en Mercado Pago no se completó. Puedes volver a intentarlo.', 'error');
    window.history.replaceState({}, document.title, window.location.pathname);
  }
}

// ==========================================
// INICIALIZACIÓN DE LA APLICACIÓN
// ==========================================

async function checkSession() {
  verificarRetornoMercadoPago();

  if (!authToken) {
    resetDashboardView();
    openModal('modalAuth');
    return;
  }

  try {
    const res = await fetch('/api/auth/me', {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });

    if (res.ok) {
      const data = await res.json();
      updateAuthUI(data.user);
      closeModal('modalAuth');
      await loadAllData();
      initGuiasUsuario();

      // Iniciar en el modo de espacio de trabajo guardado (personal o negocios)
      switchWorkspaceMode(currentWorkspaceMode);

      // Si es un usuario nuevo que no ha visto el tour, mostrar la Guía de Bienvenida
      if (localStorage.getItem('metrica_tour_seen') !== 'true') {
        setTimeout(() => {
          abrirModalGuiaGeneral();
        }, 1000);
      }
    } else {
      logout(false);
      openModal('modalAuth');
    }
  } catch (err) {
    console.error('Error validando sesión:', err);
    openModal('modalAuth');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  actualizarIconoPrivacidad();
  actualizarBotonesMoneda();
  if (window.lucide) lucide.createIcons();
  initGuiasUsuario();
  initGoogleAuth();
  switchWorkspaceMode(currentWorkspaceMode);
  checkSession();
});

