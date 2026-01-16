import './styles.css';
import {
  toHex,
  createPublicClient,
  createWalletClient,
  http,
  formatEther,
  parseEther,
  encodeFunctionData,
  concat,
  decodeEventLog,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { secp256k1 } from '@noble/curves/secp256k1';
import { foundry } from 'viem/chains';
import { abis } from '@/data/abis';
import { constants } from '@/data/constants';
import { addressBook } from '@/data/addressBook';
import { createMetaData } from '@/helpers/createMetaData';
import { computeSharedSecret, hashSharedSecret, getViewTag } from '@/helpers/computeSharedSecret';
import { computeStealthPublicKeyAndAddress } from '@/helpers/computeStealthPublicKey';
import { parseData } from '@/helpers/parseData';

const SESSION_KEYS_STORAGE = 'stealth_session_keys';
const SESSION_META_ADDRESS_STORAGE = 'stealth_meta_address';
const SESSION_OPENFORT_STORAGE = 'stealth_openfort_key';
const SESSION_CHANNELS_STORAGE = 'stealth_saved_channels';
const SESSION_HISTORY_STORAGE = 'stealth_transaction_history';

// Anvil RPC URL
const RPC_URL = 'http://127.0.0.1:8545';

const app = document.querySelector('#app');

const publicClient = createPublicClient({
  chain: foundry,
  transport: http(RPC_URL),
});

app.innerHTML = `
  <div class="page">
    <header class="topbar">
      <div class="brand">
        <div class="logo-mark" aria-hidden="true">OF</div>
        <div>
          <div class="brand-name">Openfort</div>
        </div>
      </div>
      <div class="top-actions">
        <div class="network-indicator">
          <span class="network-dot"></span>
          Anvil Local Network
        </div>
      </div>
    </header>

    <div class="main-stage">
      <main class="main-grid">
        <section class="hero">
          <h1>Pay and get paid with private addresses.</h1>
          <p class="hero-copy">
            Send or request funds without exposing counterparties on-chain—while keeping full internal visibility for treasury and compliance.
          </p>

          <div class="questions">
            <div class="questions-header">
              <h2>Private payments: how it works?</h2>
              <p>Common questions teams ask before enabling stealth transfers and private requests.</p>
            </div>
            <div class="question-grid">
              <div class="question-card">
                <div class="question-meta">
                  <span class="question-label">Receiving</span>
                </div>
                <div class="question-value">How do we receive funds without exposing a static address?</div>
                <div class="question-hint">You share one “private payment identifier.” The sender derives a fresh, one-time deposit address each time—so deposits can’t be linked externally.</div>
              </div>
              <div class="question-card">
                <div class="question-meta">
                  <span class="question-label">Sending</span>
                </div>
                <div class="question-value">Can we pay the same recipient repeatedly without linkability?</div>
                <div class="question-hint">Yes. Every payment generates a new route/address for that recipient, while you retain stable internal references for invoices and accounting.</div>
              </div>
              <div class="question-card">
                <div class="question-meta">
                  <span class="question-label">Operations</span>
                </div>
                <div class="question-value">What does our treasury team see and control?</div>
                <div class="question-hint">Full internal visibility of balances and payment history—while external viewers can’t link counterparties.</div>
              </div>
              <div class="question-card">
                <div class="question-meta">
                  <span class="question-label">Compliance</span>
                </div>
                <div class="question-value">How do we reconcile and report payments?</div>
                <div class="question-hint"> Generate privacy-preserving reports/attestations for auditors without exposing counterparties publicly.</div>
              </div>
            </div>
          </div>

        </section>

        <aside class="panel">
          <div class="panel-card balance">
            <div>
              <div class="panel-kicker">Total balance</div>
              <div class="balance-amount" data-role="total-balance">0.00 USDC</div>
              <div class="panel-subtext">
                <button class="treasury-link" type="button" data-action="show-treasury">
                  <span class="explore-arrow">›</span> Explore Accounts
                </button>
              </div>
            </div>
            <button class="balance-metric" type="button" data-action="show-transactions">
              <span>Recent Transactions</span>
              <strong data-role="last-amount">+$0.00</strong>
            </button>
            <div class="transactions-popover" data-role="transactions-popover" aria-hidden="true">
              <div class="transactions-popover-header">
                <span>Recent Transactions</span>
                <button class="transactions-close" type="button" data-action="close-transactions">&times;</button>
              </div>
              <div class="transactions-list" data-role="transactions-list">
                <div class="transactions-empty">No transactions yet</div>
              </div>
            </div>
            <div class="treasury-popover" data-role="treasury-popover" aria-hidden="true">
              <div class="treasury-popover-header">
                <span>Accounts</span>
                <button class="treasury-close" type="button" data-action="close-treasury">Close</button>
              </div>
              <div class="treasury-list" data-role="treasury-list">
                <div class="treasury-item">
                  <div class="treasury-label">Main Account</div>
                  <div class="treasury-address" data-role="treasury-spending-address">—</div>
                  <div class="treasury-balance" data-role="treasury-spending-balance">0.00 USDC</div>
                </div>
              </div>
            </div>
          </div>

          <div class="panel-card action-card">
            <div class="panel-title">What would you like to do?</div>
            <div class="panel-subtext">Pick a flow to generate a private session.</div>
            <div class="action-buttons">
              <button class="action-btn request-action" type="button" data-action="request-money">
                <span class="icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round">
                    <path d="M12 5v14" />
                    <path d="M5 12h14" />
                  </svg>
                </span>
                Receive Money
              </button>
            </div>
          </div>

          </aside>
      </main>

      <aside class="request-flow" aria-hidden="true">
        <div class="panel-card request-panel">
          <button class="back-btn" type="button" data-action="go-back">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M19 12H5"/>
              <path d="M12 19l-7-7 7-7"/>
            </svg>
            Back
          </button>
          <div class="request-header">
            <div class="panel-title">Receive USDC in a private account</div>
          </div>
          <button class="primary generate-btn" type="button" data-action="generate-channel">
            Receive
          </button>
        </div>

        <div class="panel-card activated-panel" data-role="activated-panel">
          <button class="back-btn" type="button" data-action="go-back">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M19 12H5"/>
              <path d="M12 19l-7-7 7-7"/>
            </svg>
            Back
          </button>

          <div class="request-form">
            <div class="form-header">
              <span class="form-label">Receive USDC from Openfort</span>
            </div>
            <div class="input-group">
              <div class="input-wrapper">
                <input
                  type="number"
                  class="amount-input"
                  data-role="usdc-amount"
                  placeholder="0.00"
                  min="0"
                  step="0.01"
                />
                <span class="input-suffix">USDC</span>
              </div>
            </div>
            <button class="primary request-btn" type="button" data-action="request-usdc" disabled>
              Receive USDC
            </button>
            <div class="auto-execution-hint">Automatic send execution from Openfort</div>
          </div>

          <div class="channel-info">
            <div class="info-row">
              <span>Meta Address</span>
              <span class="address-truncated" data-role="meta-preview">—</span>
            </div>
            <div class="info-row" data-role="stealth-row" style="display: none;">
              <span>Private Account</span>
              <span class="address-truncated" data-role="stealth-preview">—</span>
            </div>
          </div>

          <div class="tx-loader" data-role="tx-loader" aria-hidden="true">
            <div class="tx-loader-content">
              <div class="tx-loader-icon">
                <svg class="tx-spinner" viewBox="0 0 50 50">
                  <circle class="tx-spinner-track" cx="25" cy="25" r="20" fill="none" stroke-width="4"/>
                  <circle class="tx-spinner-progress" cx="25" cy="25" r="20" fill="none" stroke-width="4"/>
                </svg>
                <div class="tx-shield">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                  </svg>
                </div>
              </div>
              <div class="tx-loader-status" data-role="tx-status">Initializing secure channel...</div>
              <div class="tx-progress-bar">
                <div class="tx-progress-fill" data-role="tx-progress"></div>
              </div>
              <div class="tx-loader-steps">
                <div class="tx-step" data-tx-step="sending">
                  <span class="tx-step-dot"></span>
                  <span class="tx-step-label">Sending USDC</span>
                </div>
                <div class="tx-step" data-tx-step="verify">
                  <span class="tx-step-dot"></span>
                  <span class="tx-step-label">Verify Ownership</span>
                </div>
              </div>
            </div>
          </div>

        </div>

        <div class="panel-card confirmation-panel" data-role="confirmation-panel">
          <button class="back-btn" type="button" data-action="go-back">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M19 12H5"/>
              <path d="M12 19l-7-7 7-7"/>
            </svg>
            Back
          </button>

          <div class="confirmation-content">
            <div class="confirmation-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M20 6L9 17l-5-5"/>
              </svg>
            </div>
            <div class="confirmation-title">Transaction Complete</div>
            <div class="confirmation-subtitle">Your private payment was successful</div>

            <div class="confirmation-details">
              <div class="info-row">
                <span>Amount</span>
                <span class="confirmation-amount" data-role="confirmation-amount">0.00 USDC</span>
              </div>
              <div class="info-row">
                <span>Private Account</span>
                <span class="address-truncated" data-role="confirmation-address">—</span>
              </div>
            </div>
          </div>

          <button class="primary request-again-btn" type="button" data-action="request-again">
            Receive again
          </button>
        </div>
      </aside>
    </div>

    <div class="treasury-backdrop" data-role="treasury-backdrop" aria-hidden="true"></div>
  </div>
`;

const page = document.querySelector('.page');
const requestButton = document.querySelector('[data-action="request-money"]');
const requestFlow = document.querySelector('.request-flow');
const requestPanel = document.querySelector('.request-panel');
const generateButton = document.querySelector('[data-action="generate-channel"]');
const activatedPanel = document.querySelector('[data-role="activated-panel"]');
const usdcAmountInput = document.querySelector('[data-role="usdc-amount"]');
const requestUsdcButton = document.querySelector('[data-action="request-usdc"]');
const metaPreview = document.querySelector('[data-role="meta-preview"]');
const stealthPreview = document.querySelector('[data-role="stealth-preview"]');
const stealthRow = document.querySelector('[data-role="stealth-row"]');
const totalBalanceDisplay = document.querySelector('[data-role="total-balance"]');
const balanceStatusDisplay = document.querySelector('[data-role="balance-status"]');
const lastAmountDisplay = document.querySelector('[data-role="last-amount"]');
const treasuryButton = document.querySelector('[data-action="show-treasury"]');
const treasuryPopover = document.querySelector('[data-role="treasury-popover"]');
const treasuryBackdrop = document.querySelector('[data-role="treasury-backdrop"]');
const treasuryCloseButton = document.querySelector('[data-action="close-treasury"]');
const transactionsButton = document.querySelector('[data-action="show-transactions"]');
const transactionsPopover = document.querySelector('[data-role="transactions-popover"]');
const transactionsCloseButton = document.querySelector('[data-action="close-transactions"]');
const transactionsList = document.querySelector('[data-role="transactions-list"]');
const treasurySpendingAddress = document.querySelector('[data-role="treasury-spending-address"]');
const treasurySpendingBalance = document.querySelector('[data-role="treasury-spending-balance"]');
const treasuryList = document.querySelector('[data-role="treasury-list"]');
const backButtons = document.querySelectorAll('[data-action="go-back"]');
const txLoader = document.querySelector('[data-role="tx-loader"]');
const txStatus = document.querySelector('[data-role="tx-status"]');
const txProgress = document.querySelector('[data-role="tx-progress"]');
const txSteps = {
  sending: document.querySelector('[data-tx-step="sending"]'),
  verify: document.querySelector('[data-tx-step="verify"]'),
};
const confirmationPanel = document.querySelector('[data-role="confirmation-panel"]');
const confirmationAmount = document.querySelector('[data-role="confirmation-amount"]');
const confirmationAddress = document.querySelector('[data-role="confirmation-address"]');
const requestAgainButton = document.querySelector('[data-action="request-again"]');

let sessionKeys = null;
let sessionMetaAddress = '';
let openfortKey = null;
let stealthAddress = '';
let spendingAddress = '';
let currentTotalBalance = 0;
let currentSpendingBalance = 0n;
let savedChannels = []; // Array of { address, keys, metaAddress, balance }
let transactionHistory = []; // Max 5 transactions

const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

const createKeyPair = async (name) => {
  const privateKey = generatePrivateKey();
  const publicKeyBytes = secp256k1.getPublicKey(privateKey.slice(2), true);
  const publicKey = toHex(publicKeyBytes);
  return { name, privateKey, publicKey };
};

const createKeys = async () => {
  return [
    await createKeyPair('Spending Private Key'),
    await createKeyPair('Viewing Private Key'),
  ];
};

const loadKeysFromSetup = async () => {
  try {
    const response = await fetch('/session-keys.json');
    if (!response.ok) {
      return null;
    }
    const data = await response.json();
    if (data.spending && data.viewing) {
      return {
        spending: data.spending,
        viewing: data.viewing,
        openfort: data.openfort ?? null,
      };
    }
    return null;
  } catch (error) {
    console.log('No setup keys found, will generate new keys');
    return null;
  }
};

const getAddressFromKeyPair = (keyPair) => {
  return privateKeyToAccount(keyPair.privateKey).address;
};

const createWalletClientForKey = (keyPair) => {
  return createWalletClient({
    chain: foundry,
    account: privateKeyToAccount(keyPair.privateKey),
    transport: http(RPC_URL),
  });
};

const decodeStealthMetaAddress = (stealthMetaAddress) => {
  if (!stealthMetaAddress || stealthMetaAddress === '0x') {
    return null;
  }
  const body = stealthMetaAddress.slice(2);
  if (body.length < 132) {
    return null;
  }
  const spendingPublicKey = `0x${body.slice(0, 66)}`;
  const viewingPublicKey = `0x${body.slice(66, 132)}`;
  return { spendingPublicKey, viewingPublicKey };
};

const fetchUsdcBalance = async (address) => {
  try {
    const balance = await publicClient.readContract({
      address: addressBook.MOCK_ERC20_ADDRESS,
      abi: abis.ABI_ERC20,
      functionName: 'balanceOf',
      args: [address],
    });
    return balance;
  } catch (error) {
    console.warn('Failed to fetch USDC balance:', error);
    return null;
  }
};

const formatUsdcBalance = (balance) => {
  if (balance === null || balance === undefined) {
    return '0.00';
  }
  const formatted = formatEther(balance);
  const num = parseFloat(formatted);
  return num.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};

const formatUsdcNumber = (value) => {
  if (!Number.isFinite(value)) {
    return '0.00';
  }
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};

const parseDisplayNumber = (value) => {
  if (!value) {
    return 0;
  }
  const cleaned = value.replace(/[^0-9.-]/g, '');
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
};

const animateNumber = ({ element, from, to, duration = 900, formatter }) => {
  if (!element) {
    return;
  }

  if (prefersReducedMotion) {
    element.textContent = formatter(to);
    return;
  }

  const start = performance.now();
  const delta = to - from;

  const step = (now) => {
    const progress = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    const value = from + delta * eased;
    element.textContent = formatter(value);
    if (progress < 1) {
      requestAnimationFrame(step);
    } else {
      element.classList.remove('is-animating');
    }
  };

  element.classList.add('is-animating');
  requestAnimationFrame(step);
};

const saveKeysToSession = (keys) => {
  try {
    sessionStorage.setItem(SESSION_KEYS_STORAGE, JSON.stringify(keys));
  } catch (error) {
    console.warn('Failed to save keys to session storage:', error);
  }
};

const saveOpenfortToSession = (keyPair) => {
  try {
    sessionStorage.setItem(SESSION_OPENFORT_STORAGE, JSON.stringify(keyPair));
  } catch (error) {
    console.warn('Failed to save Openfort key to session storage:', error);
  }
};

const saveMetaAddressToSession = (metaAddress) => {
  try {
    sessionStorage.setItem(SESSION_META_ADDRESS_STORAGE, metaAddress);
  } catch (error) {
    console.warn('Failed to save meta-address to session storage:', error);
  }
};

const loadKeysFromSession = () => {
  try {
    const stored = sessionStorage.getItem(SESSION_KEYS_STORAGE);
    return stored ? JSON.parse(stored) : null;
  } catch (error) {
    console.warn('Failed to load keys from session storage:', error);
    return null;
  }
};

const loadOpenfortFromSession = () => {
  try {
    const stored = sessionStorage.getItem(SESSION_OPENFORT_STORAGE);
    return stored ? JSON.parse(stored) : null;
  } catch (error) {
    console.warn('Failed to load Openfort key from session storage:', error);
    return null;
  }
};

const loadMetaAddressFromSession = () => {
  try {
    return sessionStorage.getItem(SESSION_META_ADDRESS_STORAGE) || '';
  } catch (error) {
    console.warn('Failed to load meta-address from session storage:', error);
    return '';
  }
};

const saveChannelsToSession = (channels) => {
  try {
    // Convert BigInt balances to strings for serialization
    const serializable = channels.map((ch) => ({
      ...ch,
      balance: ch.balance ? ch.balance.toString() : '0',
    }));
    sessionStorage.setItem(SESSION_CHANNELS_STORAGE, JSON.stringify(serializable));
  } catch (error) {
    console.warn('Failed to save channels to session storage:', error);
  }
};

const loadChannelsFromSession = () => {
  try {
    const stored = sessionStorage.getItem(SESSION_CHANNELS_STORAGE);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    // Convert balance strings back to BigInt
    return parsed.map((ch) => ({
      ...ch,
      balance: ch.balance ? BigInt(ch.balance) : 0n,
    }));
  } catch (error) {
    console.warn('Failed to load channels from session storage:', error);
    return [];
  }
};

const saveHistoryToSession = (history) => {
  try {
    sessionStorage.setItem(SESSION_HISTORY_STORAGE, JSON.stringify(history));
  } catch (error) {
    console.warn('Failed to save history to session storage:', error);
  }
};

const loadHistoryFromSession = () => {
  try {
    const stored = sessionStorage.getItem(SESSION_HISTORY_STORAGE);
    return stored ? JSON.parse(stored) : [];
  } catch (error) {
    console.warn('Failed to load history from session storage:', error);
    return [];
  }
};

const truncateAddress = (address, startChars = 10, endChars = 8) => {
  if (!address || address.length <= startChars + endChars) {
    return address;
  }
  return `${address.slice(0, startChars)}...${address.slice(-endChars)}`;
};

const updateAssetCount = () => {
  // No longer displaying account count in UI
};

const addTransactionToHistory = (sender, amount, stealthAddr) => {
  const tx = {
    sender,
    amount,
    stealthAddress: stealthAddr,
    timestamp: Date.now(),
  };

  transactionHistory.unshift(tx);
  if (transactionHistory.length > 5) {
    transactionHistory.pop();
  }

  saveHistoryToSession(transactionHistory);
  updateLastTransaction(amount);
};

const updateLastTransaction = (amount) => {
  if (lastAmountDisplay) {
    lastAmountDisplay.textContent = `+$${formatUsdcNumber(amount)}`;
  }
};

const updateTreasuryDetails = async () => {
  // Update main account
  if (treasurySpendingAddress) {
    treasurySpendingAddress.textContent = spendingAddress ? truncateAddress(spendingAddress, 10, 8) : '—';
    treasurySpendingAddress.title = spendingAddress || '';
  }
  if (treasurySpendingBalance) {
    treasurySpendingBalance.textContent = `${formatUsdcBalance(currentSpendingBalance)} USDC`;
  }

  // Render all saved private channels dynamically
  if (treasuryList && savedChannels.length > 0) {
    // Remove existing channel rows (keep only main account)
    const existingChannelRows = treasuryList.querySelectorAll('.treasury-channel-row');
    existingChannelRows.forEach((row) => row.remove());

    // Add each saved channel
    for (let i = 0; i < savedChannels.length; i++) {
      const channel = savedChannels[i];
      const balance = channel.balance || 0n;
      const channelRow = document.createElement('div');
      channelRow.className = 'treasury-item treasury-channel-row';
      channelRow.innerHTML = `
        <div class="treasury-label">Private Account ${i + 1}</div>
        <div class="treasury-address" title="${channel.address}">${truncateAddress(channel.address, 10, 8)}</div>
        <div class="treasury-balance">${formatUsdcBalance(balance)} USDC</div>
      `;
      treasuryList.appendChild(channelRow);
    }
  }
};

const refreshTreasuryBalances = async () => {
  // Load main account from setup keys if needed
  if (!spendingAddress) {
    const setupKeys = await loadKeysFromSetup();
    if (setupKeys) {
      spendingAddress = getAddressFromKeyPair(setupKeys.spending);
    }
  }

  if (!spendingAddress) {
    if (totalBalanceDisplay) {
      totalBalanceDisplay.textContent = '0.00 USDC';
    }
    if (balanceStatusDisplay) {
      balanceStatusDisplay.textContent = 'No keys generated';
    }
    return;
  }

  if (balanceStatusDisplay) {
    balanceStatusDisplay.textContent = 'Fetching...';
  }

  // Fetch main account balance
  const spendingBalance = (await fetchUsdcBalance(spendingAddress)) ?? 0n;
  currentSpendingBalance = spendingBalance;

  // Fetch balances for all saved channels
  let channelsTotalNumber = 0;
  for (let i = 0; i < savedChannels.length; i++) {
    const channel = savedChannels[i];
    const balance = (await fetchUsdcBalance(channel.address)) ?? 0n;
    savedChannels[i].balance = balance;
    channelsTotalNumber += parseFloat(formatEther(balance));
  }

  // Calculate total
  const spendingNumber = parseFloat(formatEther(spendingBalance));
  const total = spendingNumber + channelsTotalNumber;

  if (totalBalanceDisplay) {
    animateNumber({
      element: totalBalanceDisplay,
      from: currentTotalBalance,
      to: total,
      formatter: (value) => `${formatUsdcNumber(value)} USDC`,
    });
  }

  currentTotalBalance = total;

  updateTreasuryDetails();
  updateAssetCount();
};

const resetChannelState = () => {
  // Clear current channel state for new channel generation
  sessionKeys = null;
  sessionMetaAddress = '';
  stealthAddress = '';

  // Clear session storage for current channel (but keep saved channels)
  sessionStorage.removeItem(SESSION_KEYS_STORAGE);
  sessionStorage.removeItem(SESSION_META_ADDRESS_STORAGE);
  sessionStorage.removeItem('stealth_ephemeral_key');

  // Reset UI elements
  if (metaPreview) {
    metaPreview.textContent = '—';
  }
  if (stealthPreview) {
    stealthPreview.textContent = '—';
  }
  if (stealthRow) {
    stealthRow.style.display = 'none';
  }
  if (requestPanel) {
    requestPanel.classList.remove('hidden');
  }
  if (activatedPanel) {
    activatedPanel.classList.remove('visible');
  }
  if (confirmationPanel) {
    confirmationPanel.classList.remove('visible');
  }
  if (generateButton) {
    generateButton.textContent = 'Receive';
    generateButton.disabled = false;
  }
  if (usdcAmountInput) {
    usdcAmountInput.value = '';
    usdcAmountInput.disabled = false;
  }
  if (requestUsdcButton) {
    requestUsdcButton.textContent = 'Receive USDC';
    requestUsdcButton.disabled = true;
  }
};

const showRequestFlow = () => {
  if (!page || !requestFlow) {
    return;
  }

  // Reset channel state for new channel
  resetChannelState();

  page.classList.add('request-active');
  requestFlow.setAttribute('aria-hidden', 'false');
  if (requestButton) {
    requestButton.disabled = true;
  }
};

const goBack = () => {
  if (!page || !requestFlow) {
    return;
  }

  page.classList.remove('request-active');
  requestFlow.setAttribute('aria-hidden', 'true');
  if (requestButton) {
    requestButton.disabled = false;
  }

  // Hide confirmation panel if visible
  hideConfirmationPanel();

  // Refresh balances when going back
  refreshTreasuryBalances();
};

const isKeysRegistered = async (address) => {
  try {
    const existing = await publicClient.readContract({
      address: addressBook.ERC6538_ADDRESS,
      abi: abis.ABI_ERC6538,
      functionName: 'stealthMetaAddressOf',
      args: [address, constants.SCHEME_ID],
    });
    return existing && existing !== '0x' && existing.length > 2;
  } catch {
    return false;
  }
};

const registerStealthKeys = async (spendingKey, viewingKey) => {
  const spendingAddr = getAddressFromKeyPair(spendingKey);

  // Check if already registered (setup script may have done this)
  const alreadyRegistered = await isKeysRegistered(spendingAddr);
  if (alreadyRegistered) {
    return await getStealthMetaAddress(spendingAddr);
  }

  const walletClient = createWalletClientForKey(spendingKey);
  const stealthMetaAddress = concat([spendingKey.publicKey, viewingKey.publicKey]);

  const txHash = await walletClient.sendTransaction({
    account: walletClient.account,
    to: addressBook.ERC6538_ADDRESS,
    data: encodeFunctionData({
      abi: abis.ABI_ERC6538,
      functionName: 'registerKeys',
      args: [constants.SCHEME_ID, stealthMetaAddress],
    }),
    chain: foundry,
  });

  await publicClient.waitForTransactionReceipt({ hash: txHash });
  return stealthMetaAddress;
};

const getStealthMetaAddress = async (address) => {
  return publicClient.readContract({
    address: addressBook.ERC6538_ADDRESS,
    abi: abis.ABI_ERC6538,
    functionName: 'stealthMetaAddressOf',
    args: [address, constants.SCHEME_ID],
  });
};

const mintUsdc = async (walletClient, to, amount) => {
  const txHash = await walletClient.sendTransaction({
    account: walletClient.account,
    to: addressBook.MOCK_ERC20_ADDRESS,
    data: encodeFunctionData({
      abi: abis.ABI_ERC20,
      functionName: 'mint',
      args: [to, amount],
    }),
    chain: foundry,
  });
  await publicClient.waitForTransactionReceipt({ hash: txHash });
  return txHash;
};

const transferUsdc = async (walletClient, to, amount) => {
  const txHash = await walletClient.sendTransaction({
    account: walletClient.account,
    to: addressBook.MOCK_ERC20_ADDRESS,
    data: encodeFunctionData({
      abi: abis.ABI_ERC20,
      functionName: 'transfer',
      args: [to, amount],
    }),
    chain: foundry,
  });
  await publicClient.waitForTransactionReceipt({ hash: txHash });
  return txHash;
};

const announcePayment = async (walletClient, stealthAddr, ephemeralPublicKey, metadata) => {
  const txHash = await walletClient.sendTransaction({
    account: walletClient.account,
    to: addressBook.ERC5564_ADDRESS,
    data: encodeFunctionData({
      abi: abis.ABI_ERC5564,
      functionName: 'announce',
      args: [constants.SCHEME_ID, stealthAddr, ephemeralPublicKey, metadata],
    }),
    chain: foundry,
  });
  return txHash;
};

const decodeAnnouncementFromReceipt = async (txHash) => {
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

  if (receipt.status !== 'success') {
    throw new Error('Announcement transaction failed');
  }

  const announcementLog = receipt.logs.find(
    (log) => log.address.toLowerCase() === addressBook.ERC5564_ADDRESS.toLowerCase(),
  );

  if (!announcementLog) {
    throw new Error('Announcement log not found in transaction receipt');
  }

  try {
    const decoded = decodeEventLog({
      abi: abis.ABI_ERC5564,
      data: announcementLog.data,
      topics: announcementLog.topics,
    });
    return decoded.args;
  } catch (error) {
    throw new Error(`Failed to decode announcement event: ${error.message}`);
  }
};

const updateStealthPreview = (newStealthAddress) => {
  // Show stealth row and update address when we have one
  if (stealthRow) {
    stealthRow.style.display = newStealthAddress ? '' : 'none';
  }
  if (stealthPreview && newStealthAddress) {
    stealthPreview.textContent = truncateAddress(newStealthAddress, 8, 6);
    stealthPreview.title = newStealthAddress;
  }
};

const generateChannel = async () => {
  if (!generateButton || !requestPanel) {
    return;
  }

  generateButton.disabled = true;
  generateButton.textContent = 'Generating...';

  try {
    // Always generate fresh keys for new channel
    sessionKeys = await createKeys();

    // Load openfort key if needed
    if (!openfortKey) {
      const setupKeys = await loadKeysFromSetup();
      openfortKey = setupKeys?.openfort ?? openfortKey;
    }

    const [spendingKey, viewingKey] = sessionKeys;
    const channelSpendingAddress = getAddressFromKeyPair(spendingKey);

    // Fund the new spending key with ETH for gas (from openfort)
    if (openfortKey) {
      const openfortWallet = createWalletClientForKey(openfortKey);
      const txHash = await openfortWallet.sendTransaction({
        account: openfortWallet.account,
        to: channelSpendingAddress,
        value: parseEther('0.1'),
        chain: foundry,
      });
      await publicClient.waitForTransactionReceipt({ hash: txHash });
    }

    await registerStealthKeys(spendingKey, viewingKey);
    const stealthMetaAddress = await getStealthMetaAddress(channelSpendingAddress);
    const decoded = decodeStealthMetaAddress(stealthMetaAddress);

    if (!decoded) {
      throw new Error('Failed to decode stealth meta address');
    }

    sessionMetaAddress = `st:eth:0x${decoded.spendingPublicKey.slice(2)}${decoded.viewingPublicKey.slice(2)}`;

    // Pre-compute stealth address for display
    const ephemeralKey = await createKeyPair('Ephemeral Key');
    const sharedSecretX = await computeSharedSecret({ keyPair: ephemeralKey }, decoded.viewingPublicKey);
    const sharedSecretHash = await hashSharedSecret(sharedSecretX);
    const { stealthAddress: computedStealthAddress } = await computeStealthPublicKeyAndAddress(
      sharedSecretHash,
      decoded.spendingPublicKey,
    );
    stealthAddress = computedStealthAddress;

    // Store ephemeral key for later use in transfer
    sessionStorage.setItem('stealth_ephemeral_key', JSON.stringify(ephemeralKey));

    saveKeysToSession(sessionKeys);
    saveMetaAddressToSession(sessionMetaAddress);
    if (openfortKey) {
      saveOpenfortToSession(openfortKey);
    }

    // Update meta preview with truncated address
    if (metaPreview) {
      metaPreview.textContent = truncateAddress(sessionMetaAddress, 12, 10);
      metaPreview.title = sessionMetaAddress;
    }

    // Update stealth preview with Private Account address
    updateStealthPreview(stealthAddress);

    // Go directly to activated panel
    requestPanel.classList.add('hidden');
    if (activatedPanel) {
      activatedPanel.classList.add('visible');
    }

    generateButton.textContent = 'Request';
  } catch (error) {
    console.error('Failed to generate private channel', error);
    generateButton.disabled = false;
    generateButton.textContent = 'Request';
  }
};

const handleAmountInput = () => {
  if (!usdcAmountInput || !requestUsdcButton) {
    return;
  }

  const value = parseFloat(usdcAmountInput.value);
  requestUsdcButton.disabled = isNaN(value) || value <= 0;
};

const openTreasury = () => {
  if (!treasuryPopover || !treasuryBackdrop) {
    return;
  }
  updateTreasuryDetails();
  treasuryPopover.classList.add('visible');
  treasuryPopover.setAttribute('aria-hidden', 'false');
  treasuryBackdrop.classList.add('visible');
  treasuryBackdrop.setAttribute('aria-hidden', 'false');
};

const closeTreasury = () => {
  if (!treasuryPopover || !treasuryBackdrop) {
    return;
  }
  treasuryPopover.classList.remove('visible');
  treasuryPopover.setAttribute('aria-hidden', 'true');
  treasuryBackdrop.classList.remove('visible');
  treasuryBackdrop.setAttribute('aria-hidden', 'true');
};

const updateTransactionsList = () => {
  if (!transactionsList) return;

  if (transactionHistory.length === 0) {
    transactionsList.innerHTML = '<div class="transactions-empty">No transactions yet</div>';
    return;
  }

  transactionsList.innerHTML = transactionHistory
    .map((tx) => `
      <div class="transactions-item">
        <div class="transactions-item-info">
          <span class="transactions-item-sender">${tx.sender}</span>
          <span class="transactions-item-address">${truncateAddress(tx.stealthAddress, 8, 6)}</span>
        </div>
        <span class="transactions-item-amount">+$${formatUsdcNumber(tx.amount)}</span>
      </div>
    `)
    .join('');
};

const openTransactions = () => {
  if (!transactionsPopover) {
    return;
  }
  updateTransactionsList();
  transactionsPopover.classList.add('visible');
  transactionsPopover.setAttribute('aria-hidden', 'false');
};

const closeTransactions = () => {
  if (!transactionsPopover) {
    return;
  }
  transactionsPopover.classList.remove('visible');
  transactionsPopover.setAttribute('aria-hidden', 'true');
};

const showTxLoader = () => {
  if (!txLoader) return;
  txLoader.classList.add('visible');
  txLoader.classList.remove('success');
  txLoader.setAttribute('aria-hidden', 'false');
  // Reset steps
  Object.values(txSteps).forEach((step) => {
    if (step) {
      step.classList.remove('active', 'complete');
    }
  });
  if (txProgress) txProgress.style.width = '0%';
  if (txStatus) txStatus.textContent = 'Initializing secure channel...';
};

const hideTxLoader = () => {
  if (!txLoader) return;
  txLoader.classList.remove('visible');
  txLoader.setAttribute('aria-hidden', 'true');
};

const setTxStep = (step, state) => {
  const stepEl = txSteps[step];
  if (!stepEl) return;
  stepEl.classList.remove('active', 'complete');
  if (state === 'active') {
    stepEl.classList.add('active');
  } else if (state === 'complete') {
    stepEl.classList.add('complete');
  }
};

const setTxProgress = (percent) => {
  if (txProgress) txProgress.style.width = `${percent}%`;
};

const setTxStatus = (text) => {
  if (txStatus) txStatus.textContent = text;
};

const completeTxLoader = () => {
  if (!txLoader) return;
  txLoader.classList.add('success');
  setTxProgress(100);
  setTxStatus('Transaction complete!');
  Object.values(txSteps).forEach((step) => {
    if (step) {
      step.classList.remove('active');
      step.classList.add('complete');
    }
  });
};

const showConfirmationPanel = (amount, address) => {
  // Hide activated panel
  if (activatedPanel) {
    activatedPanel.classList.remove('visible');
  }
  // Hide request panel
  if (requestPanel) {
    requestPanel.classList.add('hidden');
  }
  // Show confirmation panel
  if (confirmationPanel) {
    confirmationPanel.classList.add('visible');
  }
  // Update confirmation details
  if (confirmationAmount) {
    confirmationAmount.textContent = `${formatUsdcNumber(amount)} USDC`;
  }
  if (confirmationAddress && address) {
    confirmationAddress.textContent = truncateAddress(address, 8, 6);
    confirmationAddress.title = address;
  }
};

const hideConfirmationPanel = () => {
  if (confirmationPanel) {
    confirmationPanel.classList.remove('visible');
  }
};

const requestAgain = () => {
  hideConfirmationPanel();
  resetChannelState();
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const requestUsdc = async () => {
  if (!usdcAmountInput || !requestUsdcButton) {
    return;
  }

  const amountValue = parseFloat(usdcAmountInput.value);
  if (isNaN(amountValue) || amountValue <= 0) {
    return;
  }

  requestUsdcButton.disabled = true;
  usdcAmountInput.disabled = true;
  requestUsdcButton.textContent = 'Processing...';

  showTxLoader();

  try {
    await runRequestFlow(amountValue);

    // Show completion state
    completeTxLoader();
    await delay(800);

    hideTxLoader();

    // Show confirmation panel instead of resetting
    await delay(300);
    showConfirmationPanel(amountValue, stealthAddress);
  } catch (error) {
    console.error('Request failed', error);
    hideTxLoader();
    requestUsdcButton.textContent = 'Try Again';
    requestUsdcButton.disabled = false;
    usdcAmountInput.disabled = false;
  }
};

const runRequestFlow = async (amountValue) => {
  if (!sessionKeys || sessionKeys.length < 2) {
    throw new Error('Missing spending/viewing keys');
  }

  if (!openfortKey) {
    const setupKeys = await loadKeysFromSetup();
    openfortKey = setupKeys?.openfort ?? openfortKey;
    if (openfortKey) {
      saveOpenfortToSession(openfortKey);
    }
  }

  if (!openfortKey) {
    throw new Error('OpenFort key not available. Run setup first.');
  }

  const [spendingKey, viewingKey] = sessionKeys;
  const channelSpendingAddress = getAddressFromKeyPair(spendingKey);
  const openfortAddress = getAddressFromKeyPair(openfortKey);
  const openfortWallet = createWalletClientForKey(openfortKey);

  // Step 1: Sending USDC (0-66%)
  setTxStep('sending', 'active');
  setTxStatus('Preparing transfer...');
  setTxProgress(10);
  await delay(500);

  const amount = parseEther(String(amountValue));
  await mintUsdc(openfortWallet, openfortAddress, amount);

  setTxProgress(20);
  setTxStatus('Computing stealth address...');
  await delay(400);

  // Use the ephemeral key stored during channel generation
  const storedEphemeralKey = sessionStorage.getItem('stealth_ephemeral_key');
  const ephemeralKey = storedEphemeralKey ? JSON.parse(storedEphemeralKey) : await createKeyPair('Ephemeral Key');

  const stealthMetaAddress = await getStealthMetaAddress(channelSpendingAddress);
  const decoded = decodeStealthMetaAddress(stealthMetaAddress);
  if (!decoded) {
    throw new Error('Failed to load stealth meta address');
  }

  setTxProgress(30);
  setTxStatus('Generating shared secret...');
  await delay(400);

  const sharedSecretX = await computeSharedSecret({ keyPair: ephemeralKey }, decoded.viewingPublicKey);
  const sharedSecretHash = await hashSharedSecret(sharedSecretX);
  const viewTag = await getViewTag(sharedSecretHash);

  const metaData = await createMetaData(
    viewTag,
    constants.TRANSFER_ERC20_SELECTOR,
    addressBook.MOCK_ERC20_ADDRESS,
    amount,
  );

  const { stealthAddress: computedStealthAddress } = await computeStealthPublicKeyAndAddress(
    sharedSecretHash,
    decoded.spendingPublicKey,
  );

  stealthAddress = computedStealthAddress;
  updateAssetCount();

  setTxProgress(45);
  setTxStatus('Transferring to private account...');
  await delay(400);

  await transferUsdc(openfortWallet, stealthAddress, amount);

  setTxProgress(55);
  setTxStatus('Broadcasting announcement...');
  await delay(300);

  const announcementTx = await announcePayment(
    openfortWallet,
    stealthAddress,
    ephemeralKey.publicKey,
    metaData,
  );

  setTxStep('sending', 'complete');
  setTxProgress(66);
  await delay(400);

  // Step 3: Verify Ownership (66-100%) - ~1.5 sec
  setTxStep('verify', 'active');
  setTxStatus('Verifying receiver ownership...');
  await delay(500);

  const announcement = await decodeAnnouncementFromReceipt(announcementTx);

  setTxProgress(80);
  setTxStatus('Deriving private key...');
  await delay(400);

  const stealthPrivKey = await parseData([spendingKey, viewingKey], announcement);
  if (!stealthPrivKey) {
    throw new Error('Receiver view tag mismatch');
  }

  // Verify the derived private key matches the stealth address
  const derivedAccount = privateKeyToAccount(stealthPrivKey);
  if (derivedAccount.address.toLowerCase() !== stealthAddress.toLowerCase()) {
    throw new Error('Derived address does not match stealth address');
  }

  setTxProgress(90);
  setTxStatus('Updating balances...');
  await delay(400);

  // Save channel to savedChannels after successful transfer (if not already saved)
  const alreadySaved = savedChannels.some((ch) => ch.address.toLowerCase() === stealthAddress.toLowerCase());
  if (!alreadySaved) {
    const channelToSave = {
      address: stealthAddress,
      keys: sessionKeys,
      metaAddress: sessionMetaAddress,
      balance: 0n,
      createdAt: Date.now(),
    };
    savedChannels.push(channelToSave);
    saveChannelsToSession(savedChannels);
  }

  await refreshTreasuryBalances();

  // Add transaction to history
  addTransactionToHistory('Openfort', amountValue, stealthAddress);

  setTxStep('verify', 'complete');
};

const initFromSession = async () => {
  openfortKey = loadOpenfortFromSession();
  savedChannels = loadChannelsFromSession();
  transactionHistory = loadHistoryFromSession();

  const setupKeys = await loadKeysFromSetup();

  if (!openfortKey && setupKeys?.openfort) {
    openfortKey = setupKeys.openfort;
    saveOpenfortToSession(openfortKey);
  }

  // Set main account spending address from setup keys
  if (setupKeys?.spending) {
    spendingAddress = getAddressFromKeyPair(setupKeys.spending);
  }

  if (totalBalanceDisplay) {
    currentTotalBalance = parseDisplayNumber(totalBalanceDisplay.textContent);
  }

  // Update last transaction display if we have history
  if (transactionHistory.length > 0) {
    const lastTx = transactionHistory[0];
    updateLastTransaction(lastTx.sender, lastTx.amount);
  }

  await refreshTreasuryBalances();
};

initFromSession();

if (requestButton) {
  requestButton.addEventListener('click', showRequestFlow);
}

if (generateButton) {
  generateButton.addEventListener('click', generateChannel);
}

backButtons.forEach((btn) => {
  btn.addEventListener('click', goBack);
});

if (usdcAmountInput) {
  usdcAmountInput.addEventListener('input', handleAmountInput);
}

if (requestUsdcButton) {
  requestUsdcButton.addEventListener('click', requestUsdc);
}

if (treasuryButton) {
  treasuryButton.addEventListener('click', openTreasury);
}

if (treasuryCloseButton) {
  treasuryCloseButton.addEventListener('click', closeTreasury);
}

if (treasuryBackdrop) {
  treasuryBackdrop.addEventListener('click', closeTreasury);
}

if (transactionsButton) {
  transactionsButton.addEventListener('click', openTransactions);
}

if (transactionsCloseButton) {
  transactionsCloseButton.addEventListener('click', closeTransactions);
}

if (requestAgainButton) {
  requestAgainButton.addEventListener('click', requestAgain);
}

// Close transactions popover when clicking outside
document.addEventListener('click', (e) => {
  if (transactionsPopover && transactionsPopover.classList.contains('visible')) {
    if (!transactionsPopover.contains(e.target) && !transactionsButton.contains(e.target)) {
      closeTransactions();
    }
  }
});
