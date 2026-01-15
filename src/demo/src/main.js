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
          <div class="brand-name">OpenFort</div>
          <div class="brand-sub">Private Payments</div>
        </div>
      </div>
      <div class="top-actions">
        <button class="primary" type="button">Privacy Shield Active</button>
      </div>
    </header>

    <div class="main-stage">
      <main class="main-grid">
        <section class="hero">
          <div class="eyebrow">Private Payment System</div>
          <h1>Private payment system access for enterprise-grade privacy.</h1>
          <p class="hero-copy">
            Move funds without exposing counterparties. This demo captures the first-step
            questions before initiating a stealth transfer or private request.
          </p>

          <div class="questions">
            <div class="questions-header">
              <h2>FAQ for private payments</h2>
              <p>Answers to the most common questions about receiving and sending privately.</p>
            </div>
            <div class="question-grid">
              <div class="question-card">
                <div class="question-meta">
                  <span class="question-label">Receiving</span>
                  <span class="question-tag">FAQ</span>
                </div>
                <div class="question-value">How do we receive without revealing our address?</div>
                <div class="question-hint">Share a private meta-address and auto-derive a one-time deposit.</div>
              </div>
              <div class="question-card">
                <div class="question-meta">
                  <span class="question-label">Sending</span>
                  <span class="question-tag soft">FAQ</span>
                </div>
                <div class="question-value">Can we pay vendors without linking transactions?</div>
                <div class="question-hint">Each transfer uses a fresh Private Payment channel per recipient.</div>
              </div>
              <div class="question-card">
                <div class="question-meta">
                  <span class="question-label">Operations</span>
                  <span class="question-tag">FAQ</span>
                </div>
                <div class="question-value">What does our treasury team see and control?</div>
                <div class="question-hint">Full internal visibility with external unlinkability by default.</div>
              </div>
              <div class="question-card">
                <div class="question-meta">
                  <span class="question-label">Compliance</span>
                  <span class="question-tag soft">FAQ</span>
                </div>
                <div class="question-value">How do we reconcile and report payments?</div>
                <div class="question-hint">Generate attestations for auditors without exposing counterparties.</div>
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
                  Private Treasury <span data-role="account-count">1</span>
                </button>
                <span class="separator">•</span>
                <span data-role="balance-status">Connecting...</span>
              </div>
            </div>
            <div class="balance-metric">
              <span data-role="last-sender">Alice</span>
              <strong data-role="last-amount">+$8,240.00</strong>
            </div>
            <div class="treasury-popover" data-role="treasury-popover" aria-hidden="true">
              <div class="treasury-popover-header">
                <span>Private Treasury</span>
                <button class="treasury-close" type="button" data-action="close-treasury">Close</button>
              </div>
              <div class="treasury-list" data-role="treasury-list">
                <div class="treasury-item">
                  <div class="treasury-label">Main Account</div>
                  <div class="treasury-address" data-role="treasury-spending-address">—</div>
                  <div class="treasury-balance" data-role="treasury-spending-balance">0.00 USDC</div>
                </div>
              </div>
              <div class="treasury-history" data-role="treasury-history">
                <div class="treasury-history-header">Recent Transactions</div>
                <div class="treasury-history-list" data-role="history-list">
                  <div class="treasury-history-empty">No transactions yet</div>
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
                Request Money
              </button>
              <button class="action-btn alt" type="button">
                <span class="icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M20 4L9.5 14.5" />
                    <path d="M20 4l-5 16-3.5-5.5L4 13l16-9z" />
                  </svg>
                </span>
                Send Money
              </button>
            </div>
          </div>

          <div class="panel-card">
            <div class="panel-title">Privacy posture</div>
            <div class="status-row">
              <span>Private Payments</span>
              <span class="status-pill">Enabled</span>
            </div>
            <div class="status-row">
              <span>Unlinkability</span>
              <span class="status-pill neutral" data-role="unlinkability-status">Pending</span>
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
            <div class="panel-title">Private payment request</div>
            <div class="panel-subtext">Generate a channel to share a stealth meta-address.</div>
          </div>
          <button class="primary generate-btn" type="button" data-action="generate-channel">
            Generate New Channel
          </button>
          <div class="qr-block" data-role="qr-block">
            <div class="qr-frame">
              <img class="qr-image" alt="Stealth meta-address QR code" data-role="qr-code" />
            </div>
            <div class="meta-address-display" data-role="meta-address"></div>
          </div>
          <button class="primary activate-btn" type="button" data-action="activate-channel" disabled>
            Activate
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
          <div class="activated-header">
            <div class="activated-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
            </div>
            <div class="panel-title">Payment Channel Activated</div>
            <div class="panel-subtext">Your private channel is ready to receive funds.</div>
          </div>

          <div class="request-form">
            <div class="form-header">
              <span class="form-label">Request USDC from OpenFort</span>
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
              Request USDC
            </button>
          </div>

          <div class="channel-info">
            <div class="info-row">
              <span>Channel Status</span>
              <span class="status-pill">Active</span>
            </div>
            <div class="info-row">
              <span>Meta Address</span>
              <span class="address-truncated" data-role="meta-preview">—</span>
            </div>
            <div class="info-row" data-role="stealth-row" style="display: none;">
              <span>Private Channel</span>
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
                <div class="tx-step" data-tx-step="mint">
                  <span class="tx-step-dot"></span>
                  <span class="tx-step-label">Mint USDC</span>
                </div>
                <div class="tx-step" data-tx-step="transfer">
                  <span class="tx-step-dot"></span>
                  <span class="tx-step-label">Private Transfer</span>
                </div>
                <div class="tx-step" data-tx-step="verify">
                  <span class="tx-step-dot"></span>
                  <span class="tx-step-label">Verify Ownership</span>
                </div>
              </div>
            </div>
          </div>

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
const activateButton = document.querySelector('[data-action="activate-channel"]');
const qrImage = document.querySelector('[data-role="qr-code"]');
const metaAddressDisplay = document.querySelector('[data-role="meta-address"]');
const activatedPanel = document.querySelector('[data-role="activated-panel"]');
const usdcAmountInput = document.querySelector('[data-role="usdc-amount"]');
const requestUsdcButton = document.querySelector('[data-action="request-usdc"]');
const metaPreview = document.querySelector('[data-role="meta-preview"]');
const stealthPreview = document.querySelector('[data-role="stealth-preview"]');
const stealthRow = document.querySelector('[data-role="stealth-row"]');
const totalBalanceDisplay = document.querySelector('[data-role="total-balance"]');
const balanceStatusDisplay = document.querySelector('[data-role="balance-status"]');
const lastSenderDisplay = document.querySelector('[data-role="last-sender"]');
const lastAmountDisplay = document.querySelector('[data-role="last-amount"]');
const assetCountDisplay = document.querySelector('[data-role="asset-count"]');
const accountCountDisplay = document.querySelector('[data-role="account-count"]');
const historyList = document.querySelector('[data-role="history-list"]');
const unlinkabilityStatus = document.querySelector('[data-role="unlinkability-status"]');
const treasuryButton = document.querySelector('[data-action="show-treasury"]');
const treasuryPopover = document.querySelector('[data-role="treasury-popover"]');
const treasuryBackdrop = document.querySelector('[data-role="treasury-backdrop"]');
const treasuryCloseButton = document.querySelector('[data-action="close-treasury"]');
const treasurySpendingAddress = document.querySelector('[data-role="treasury-spending-address"]');
const treasurySpendingBalance = document.querySelector('[data-role="treasury-spending-balance"]');
const treasuryList = document.querySelector('[data-role="treasury-list"]');
const backButtons = document.querySelectorAll('[data-action="go-back"]');
const txLoader = document.querySelector('[data-role="tx-loader"]');
const txStatus = document.querySelector('[data-role="tx-status"]');
const txProgress = document.querySelector('[data-role="tx-progress"]');
const txSteps = {
  mint: document.querySelector('[data-tx-step="mint"]'),
  transfer: document.querySelector('[data-tx-step="transfer"]'),
  verify: document.querySelector('[data-tx-step="verify"]'),
};

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
  // Always 1 asset (USDC)
  if (assetCountDisplay) {
    assetCountDisplay.textContent = '1';
  }
  // Update account count: 1 (Main) + number of saved channels
  if (accountCountDisplay) {
    const channelCount = savedChannels.length;
    accountCountDisplay.textContent = String(1 + channelCount);
  }
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
  updateHistoryDisplay();
  updateLastTransaction(sender, amount);
};

const updateHistoryDisplay = () => {
  if (!historyList) return;

  if (transactionHistory.length === 0) {
    historyList.innerHTML = '<div class="treasury-history-empty">No transactions yet</div>';
    return;
  }

  historyList.innerHTML = transactionHistory
    .map((tx) => `
      <div class="treasury-tx">
        <div class="treasury-tx-info">
          <span class="treasury-tx-sender">${tx.sender}</span>
          <span class="treasury-tx-address">${truncateAddress(tx.stealthAddress, 8, 6)}</span>
        </div>
        <span class="treasury-tx-amount">+$${formatUsdcNumber(tx.amount)}</span>
      </div>
    `)
    .join('');
};

const updateLastTransaction = (sender, amount) => {
  if (lastSenderDisplay) {
    lastSenderDisplay.textContent = sender;
  }
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
        <div class="treasury-label">Private Channel ${i + 1}</div>
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

  if (balanceStatusDisplay) {
    balanceStatusDisplay.textContent = 'Updated just now';
  }
};

const resetChannelState = () => {
  // Clear current channel state for new channel generation
  sessionKeys = null;
  sessionMetaAddress = '';
  stealthAddress = '';

  // Clear session storage for current channel (but keep saved channels)
  sessionStorage.removeItem(SESSION_KEYS_STORAGE);
  sessionStorage.removeItem(SESSION_META_ADDRESS_STORAGE);

  // Reset UI elements
  if (qrImage) {
    qrImage.src = '';
  }
  if (metaAddressDisplay) {
    metaAddressDisplay.textContent = '';
  }
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
    requestPanel.classList.remove('has-keys', 'hidden');
  }
  if (activatedPanel) {
    activatedPanel.classList.remove('visible');
  }
  if (generateButton) {
    generateButton.textContent = 'Generate New Channel';
    generateButton.disabled = false;
  }
  if (activateButton) {
    activateButton.disabled = true;
  }
  if (usdcAmountInput) {
    usdcAmountInput.value = '';
    usdcAmountInput.disabled = false;
  }
  if (requestUsdcButton) {
    requestUsdcButton.textContent = 'Request USDC';
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

  // Refresh balances when going back
  refreshTreasuryBalances();
};

const renderQr = (metaAddress) => {
  if (!qrImage) {
    return;
  }

  const size = 220;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(
    metaAddress,
  )}`;
  qrImage.src = qrUrl;

  if (metaAddressDisplay) {
    metaAddressDisplay.textContent = truncateAddress(metaAddress, 14, 10);
    metaAddressDisplay.title = metaAddress;
  }
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
  // Update meta address preview
  if (metaPreview) {
    const metaValue = sessionMetaAddress ? sessionMetaAddress.replace('st:eth:', '') : '—';
    metaPreview.textContent = truncateAddress(metaValue, 8, 6);
    metaPreview.title = metaValue;
  }

  // Update stealth address preview (only show when we have one)
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

    saveKeysToSession(sessionKeys);
    saveMetaAddressToSession(sessionMetaAddress);
    if (openfortKey) {
      saveOpenfortToSession(openfortKey);
    }

    renderQr(sessionMetaAddress);
    requestPanel.classList.add('has-keys');
    if (activateButton) {
      activateButton.disabled = false;
    }
    generateButton.textContent = 'Channel Ready';
  } catch (error) {
    console.error('Failed to generate private channel', error);
    generateButton.disabled = false;
    generateButton.textContent = 'Generate New Channel';
  }
};

const activateChannel = () => {
  if (!requestPanel || !activatedPanel) {
    return;
  }

  requestPanel.classList.add('hidden');
  activatedPanel.classList.add('visible');

  // Update Unlinkability status to Enabled
  if (unlinkabilityStatus) {
    unlinkabilityStatus.textContent = 'Enabled';
    unlinkabilityStatus.classList.remove('neutral');
  }

  updateStealthPreview();
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
  updateHistoryDisplay();
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
    requestUsdcButton.textContent = 'Request Sent';
    usdcAmountInput.value = '';
    usdcAmountInput.disabled = false;

    // Reset button after 2 seconds to allow more requests
    setTimeout(() => {
      requestUsdcButton.textContent = 'Request USDC';
      requestUsdcButton.disabled = true; // Will enable when amount is entered
    }, 2000);
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

  // Step 1: Mint USDC (0-33%) - ~1.5 sec
  setTxStep('mint', 'active');
  setTxStatus('Minting USDC to OpenFort...');
  setTxProgress(10);
  await delay(500);

  const amount = parseEther(String(amountValue));
  await mintUsdc(openfortWallet, openfortAddress, amount);

  setTxProgress(25);
  await delay(600);
  setTxStep('mint', 'complete');
  setTxProgress(33);
  await delay(400);

  // Step 2: Stealth Transfer (33-66%) - ~2 sec
  setTxStep('transfer', 'active');
  setTxStatus('Computing stealth address...');
  await delay(500);

  const ephemeralKey = await createKeyPair('Ephemeral Key');

  const stealthMetaAddress = await getStealthMetaAddress(channelSpendingAddress);
  const decoded = decodeStealthMetaAddress(stealthMetaAddress);
  if (!decoded) {
    throw new Error('Failed to load stealth meta address');
  }

  setTxProgress(40);
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
  updateStealthPreview(stealthAddress);
  updateAssetCount();

  setTxProgress(50);
  setTxStatus('Transferring to private channel...');
  await delay(400);

  await transferUsdc(openfortWallet, stealthAddress, amount);

  setTxProgress(60);
  setTxStatus('Broadcasting announcement...');
  await delay(300);

  const announcementTx = await announcePayment(
    openfortWallet,
    stealthAddress,
    ephemeralKey.publicKey,
    metaData,
  );

  setTxStep('transfer', 'complete');
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

if (activateButton) {
  activateButton.addEventListener('click', activateChannel);
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
