// app.js - ENHANCED WITH ML PREDICTIONS
// NOTE: Replace CONFIG keys with your real API keys

const CONFIG = {
    stocks: ['GOOGL', 'AAPL', 'MSFT', 'AMZN', 'TSLA', 'NVDA'],
    FINNHUB_KEY: 'd4ivcg1r01queuakp4pgd4ivcg1r01queuakp4q0',
    FINNHUB_REST_SEARCH: 'https://finnhub.io/api/v1/search?q=',
    FINNHUB_QUOTE: 'https://finnhub.io/api/v1/quote?symbol=',
    FINNHUB_CANDLE: 'https://finnhub.io/api/v1/stock/candle',
    STOCKDATA_TOKEN: 'H9IuvBwPXRLWDdJhnia5uwDsujNk106qGLyL3yW4',
    STOCKDATA_QUOTE: 'https://api.stockdata.org/v1/data/quote',
    STOCKDATA_EOD: 'https://api.stockdata.org/v1/data/eod',
    STOCKDATA_NEWS: 'https://api.stockdata.org/v1/news/all',
    NEWS_API_KEY: '06e8ae8f37b549a5bb8727f9e46bbfc3',
    NEWS_API_URL: 'https://newsapi.org/v2/everything',
    refreshInterval: 60000,
    restFallbackInterval: 8000,
    retryAttempts: 3,
    mlEnabled: true, // Toggle ML predictions
    autoTrain: true  // Auto-train model on new data
};

const state = {
    stockData: {},
    selectedStock: null,
    charts: {},
    isLoading: false,
    lastUpdate: null,
    useFallback: false,
    wsConnected: false,
    wsSubscribed: new Set(),
    searchHistory: [],
    pinned: new Set(),
    mlPredictor: null,
    mlStatus: 'initializing'
};

/* ---------- ML Initialization ---------- */
async function initializeMLPredictor() {
    if (!window.MLStockPredictor) {
        console.warn('ML Predictor not loaded');
        state.mlStatus = 'unavailable';
        return;
    }

    state.mlPredictor = new MLStockPredictor();
    state.mlStatus = 'ready';
    
    // Try to load pre-trained model
    const loaded = await state.mlPredictor.loadModel();
    if (loaded) {
        console.log('✓ Pre-trained model loaded');
        state.mlStatus = 'model-ready';
    } else {
        console.log('No pre-trained model found - will train on first use');
    }
    
    updateMLStatus();
}

function updateMLStatus() {
    const statusEl = document.getElementById('mlStatus');
    if (!statusEl) return;
    
    const statusMap = {
        'initializing': { text: 'Initializing...', color: '#ffd700' },
        'ready': { text: 'Ready', color: '#00ff88' },
        'training': { text: 'Training...', color: '#3a86ff' },
        'model-ready': { text: 'Model Ready', color: '#00ff88' },
        'unavailable': { text: 'Unavailable', color: '#ff4d4d' }
    };
    
    const status = statusMap[state.mlStatus] || statusMap['unavailable'];
    statusEl.textContent = status.text;
    statusEl.style.color = status.color;
}

/* ---------- Enhanced Prediction with ML ---------- */
async function calculatePredictionWithML(historicalPrices, ticker) {
    if (!CONFIG.mlEnabled || !state.mlPredictor) {
        return calculatePredictionStatistical(historicalPrices);
    }

    try {
        // If model not ready, train it
        if (!state.mlPredictor.isModelReady && CONFIG.autoTrain && historicalPrices.length >= 50) {
            console.log(`Training ML model for ${ticker}...`);
            state.mlStatus = 'training';
            updateMLStatus();
            
            const result = await state.mlPredictor.trainModel(historicalPrices, 30);
            
            if (result.success) {
                console.log(`✓ Model trained for ${ticker} - Loss: ${result.finalLoss?.toFixed(4)}`);
                state.mlStatus = 'model-ready';
                await state.mlPredictor.saveModel();
            } else {
                console.warn('Training failed, using statistical method');
                state.mlStatus = 'ready';
            }
            updateMLStatus();
        }

        // Make prediction
        const prediction = await state.mlPredictor.predict(historicalPrices);
        return prediction;

    } catch (error) {
        console.error('ML prediction error:', error);
        return calculatePredictionStatistical(historicalPrices);
    }
}

/* ---------- Statistical Prediction (Fallback) ---------- */
function calculatePredictionStatistical(historicalPrices) {
    if (!historicalPrices || historicalPrices.length < 5) return null;
    
    const recent = historicalPrices.slice(-10);
    const sum = recent.reduce((a, b) => a + b, 0);
    const avg = sum / recent.length;
    const trend = recent[recent.length - 1] - recent[0];
    const volatility = Math.sqrt(recent.reduce((acc, p) => acc + Math.pow(p - avg, 2), 0) / recent.length);
    const momentum = (recent.slice(-3).reduce((a, b) => a + b, 0) / 3) - avg;
    const prediction = recent[recent.length - 1] + trend * 0.3 + momentum * 0.2;
    const confidence = Math.max(50, Math.min(95, 70 - (volatility / (avg || 1)) * 100));
    
    return {
        predictedPrice: prediction,
        confidence: Number(confidence.toFixed(1)),
        direction: prediction > recent[recent.length - 1] ? 'up' : 'down',
        volatility: Number(volatility.toFixed(2)),
        method: 'statistical'
    };
}

/* ---------- Utilities ---------- */
function formatNumber(num) {
    if (num === null || num === undefined) return 'N/A';
    if (typeof num !== 'number') return num;
    if (num >= 1e12) return '$' + (num / 1e12).toFixed(2) + 'T';
    if (num >= 1e9) return '$' + (num / 1e9).toFixed(2) + 'B';
    if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
    return num.toLocaleString();
}

/* ---------- StockData.org helpers ---------- */
async function stockdataQuote(symbol) {
    try {
        const url = `${CONFIG.STOCKDATA_QUOTE}?symbols=${encodeURIComponent(symbol)}&api_token=${CONFIG.STOCKDATA_TOKEN}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error('stockdata quote failed');
        const json = await res.json();
        
        if (json.data && json.data.length > 0) {
            const match = json.data.find(item => 
                item.ticker === symbol || 
                item.symbol === symbol ||
                (item.ticker && item.ticker.replace(/\./g, '') === symbol.replace(/\./g, ''))
            );
            return match || null;
        }
        return null;
    } catch (e) {
        console.warn('StockData quote error', e);
        return null;
    }
}

async function stockdataEOD(symbol) {
    try {
        const url = `${CONFIG.STOCKDATA_EOD}?symbols=${encodeURIComponent(symbol)}&api_token=${CONFIG.STOCKDATA_TOKEN}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error('stockdata eod failed');
        const json = await res.json();
        return json.data || [];
    } catch (e) {
        console.warn('StockData EOD error', e);
        return [];
    }
}

async function stockdataNews(symbol) {
    try {
        const url = `${CONFIG.STOCKDATA_NEWS}?symbols=${encodeURIComponent(symbol)}&filter_entities=true&limit=10&api_token=${CONFIG.STOCKDATA_TOKEN}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error('stockdata news failed');
        const json = await res.json();
        return json.data || [];
    } catch (e) {
        console.warn('StockData NEWS error', e);
        return [];
    }
}

/* ---------- Finnhub helpers ---------- */
async function finnhubSearch(q) {
    if (!q) return [];
    const token = CONFIG.FINNHUB_KEY;
    if (!token) return [];
    try {
        const res = await fetch(`${CONFIG.FINNHUB_REST_SEARCH}${encodeURIComponent(q)}&token=${token}`);
        if (!res.ok) return [];
        const json = await res.json();
        return json.result || [];
    } catch (e) {
        console.warn('Finnhub search error', e);
        return [];
    }
}

async function finnhubQuote(symbol) {
    const token = CONFIG.FINNHUB_KEY;
    if (!token) return null;
    try {
        const res = await fetch(`${CONFIG.FINNHUB_QUOTE}${encodeURIComponent(symbol)}&token=${token}`);
        if (!res.ok) throw new Error('finnhub quote failed');
        return await res.json();
    } catch (e) {
        console.warn('Finnhub quote error', e);
        return null;
    }
}

async function finnhubCandles(symbol, resolution = '5', rangeMinutes = 120) {
    const token = CONFIG.FINNHUB_KEY;
    if (!token) return null;
    try {
        const now = Math.floor(Date.now() / 1000);
        const from = now - rangeMinutes * 60;
        const url = `${CONFIG.FINNHUB_CANDLE}?symbol=${encodeURIComponent(symbol)}&resolution=${resolution}&from=${from}&to=${now}&token=${token}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error('finnhub candles failed');
        const json = await res.json();
        if (json.s !== 'ok') return null;
        return json.t.map((ts, i) => ({ time: new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), price: json.c[i] }));
    } catch (e) {
        console.warn('Finnhub candles error', e);
        return null;
    }
}

/* ---------- NEWS fallback ---------- */
async function fetchNewsFallback(query) {
    const key = CONFIG.NEWS_API_KEY;
    if (!key) return [];
    try {
        const url = `${CONFIG.NEWS_API_URL}?q=${encodeURIComponent(query)}&sortBy=publishedAt&pageSize=6&apiKey=${key}&language=en`;
        const res = await fetch(url);
        if (!res.ok) throw new Error('news api failed');
        const json = await res.json();
        return json.articles || [];
    } catch (e) {
        console.warn('News API error', e);
        return [];
    }
}

/* ---------- Rendering helpers ---------- */
function updateLastUpdateTime() {
    const el = document.getElementById('lastUpdateTime');
    if (!el) return;
    if (!state.lastUpdate) { el.textContent = ''; return; }
    el.textContent = state.lastUpdate.toLocaleTimeString();
}

function renderNews(articles) {
    const newsContent = document.getElementById('newsContent');
    if (!newsContent) return;
    if (!articles || articles.length === 0) {
        newsContent.innerHTML = `<div class="loading-state"><p>No news available</p></div>`;
        return;
    }
    newsContent.innerHTML = articles.map((article, idx) => `
        <div class="news-article" style="animation-delay:${idx*0.05}s;">
            <div style="display:flex; gap:0.6rem;">
                ${article.urlToImage ? `<img src="${article.urlToImage}" style="width:100px;height:80px;object-fit:cover;border-radius:8px;" onerror="this.style.display='none'">` : `<div style="width:100px;height:80px;border-radius:8px;background:#0f1724;display:flex;align-items:center;justify-content:center;color:var(--text-muted)"><i class="fas fa-newspaper"></i></div>`}
                <div style="flex:1;">
                    <h4 style="font-size:0.95rem;margin-bottom:6px;">${article.title || article.headline || 'Untitled'}</h4>
                    ${article.description ? `<p style="font-size:0.85rem;color:var(--text-secondary);margin-bottom:6px;">${article.description}</p>` : ''}
                    <div style="font-size:0.8rem;color:var(--text-muted)">${new Date(article.publishedAt || article.published_at || Date.now()).toLocaleString()} • ${(article.source && article.source.name) || article.source || 'Unknown'}</div>
                    ${article.url ? `<a href="${article.url}" target="_blank" style="display:inline-block;margin-top:6px;color:var(--accent-bull);font-weight:700;">Read full article <i class="fas fa-arrow-right"></i></a>` : ''}
                </div>
            </div>
        </div>
    `).join('');
}

function renderHistoryAndPinned() {
    const historyRoot = document.getElementById('searchHistory');
    const pinnedRoot = document.getElementById('pinnedList');
    if (historyRoot) {
        historyRoot.innerHTML = '';
        state.searchHistory.slice().reverse().slice(0, 10).forEach(symbol => {
            const chip = document.createElement('div');
            chip.className = 'chip';
            chip.textContent = symbol;
            chip.onclick = () => { document.getElementById('searchInput').value = symbol; handleSearchSymbol(symbol); };
            historyRoot.appendChild(chip);
        });
    }
    if (pinnedRoot) {
        pinnedRoot.innerHTML = '';
        Array.from(state.pinned).forEach(symbol => {
            const chip = document.createElement('div');
            chip.className = 'chip';
            chip.innerHTML = `${symbol} <i class="fas fa-thumbtack" style="margin-left:8px; color: #ffd700;"></i>`;
            chip.onclick = () => { document.getElementById('searchInput').value = symbol; handleSearchSymbol(symbol); };
            pinnedRoot.appendChild(chip);
        });
    }
}

function renderStockCards() {
    const root = document.getElementById('stockGrid');
    if (!root) return;
    root.innerHTML = '';

    if (state.useFallback) {
        const warn = document.createElement('div');
        warn.style.cssText = `grid-column:1/-1;padding:1rem;border-radius:10px;background:linear-gradient(135deg, rgba(255,195,0,0.06), rgba(255,130,0,0.03));color:#ffd700;border:1px solid rgba(255,195,0,0.1);margin-bottom:0.75rem;`;
        warn.textContent = 'Using demo data. Real-time updates may not be available.';
        root.appendChild(warn);
    }

    CONFIG.stocks.forEach((ticker, idx) => {
        const data = state.stockData[ticker];
        const card = document.createElement('div');
        card.className = 'stock-card';
        card.style.animationDelay = `${idx * 0.03}s`;

        if (!data) {
            card.innerHTML = `<div class="loading-state"><i class="fas fa-spinner fa-spin"></i><p>Loading ${ticker}...</p></div>`;
        } else {
            const isPositive = (data.change || 0) >= 0;
            const methodBadge = data.prediction?.method === 'ml-lstm' 
                ? '<span style="background:rgba(58,134,255,0.15);color:#3a86ff;padding:2px 8px;border-radius:12px;font-size:0.75rem;font-weight:700;margin-left:8px;">ML</span>'
                : '';
            
            card.innerHTML = `
                <div class="stock-header">
                    <div class="stock-info">
                        <h3>${data.ticker}${methodBadge}</h3>
                        <p>${data.name || data.ticker}</p>
                    </div>
                    <div style="display:flex;gap:6px;align-items:center;">
                        <div class="stock-badge ${isPositive ? 'positive' : 'negative'}">
                            <i class="fas fa-arrow-${isPositive ? 'up' : 'down'}"></i>
                            <span style="margin-left:6px;">${Math.abs((data.changePercent||0)).toFixed(2)}%</span>
                        </div>
                        <button class="chip pin-btn" data-pin="${data.ticker}" title="Pin/unpin">${state.pinned.has(data.ticker) ? '<i class="fas fa-thumbtack"></i>' : '<i class="far fa-thumbtack"></i>'}</button>
                    </div>
                </div>

                <div>
                    <div class="current-price" style="font-size:1.4rem;font-weight:800;color:#ffd700;">$${(data.price || 0).toFixed ? (data.price).toFixed(2) : data.price}</div>
                    <div style="color:var(--text-secondary);font-size:0.85rem;">Volume: ${formatNumber(data.volume)}</div>
                </div>

                <div class="stock-chart"><canvas id="chart-${data.ticker}"></canvas></div>

                ${(data.prediction) ? `
                    <div style="display:flex;justify-content:space-between;gap:12px;margin-top:8px;">
                        <div style="flex:1;">
                            <div style="font-size:0.8rem;color:var(--text-muted);">Next Target</div>
                            <div style="font-weight:800;font-family:'Courier New',monospace;color:#ffd700;">$${data.prediction.predictedPrice.toFixed(2)}</div>
                        </div>
                        <div style="flex:1;">
                            <div style="font-size:0.8rem;color:var(--text-muted);">Confidence</div>
                            <div style="font-weight:800;">${data.prediction.confidence}%</div>
                        </div>
                    </div>
                ` : ''}
            `;

            card.querySelector('.pin-btn')?.addEventListener('click', (e) => {
                e.stopPropagation();
                const sym = e.currentTarget.getAttribute('data-pin');
                if (state.pinned.has(sym)) state.pinned.delete(sym);
                else state.pinned.add(sym);
                renderHistoryAndPinned();
                renderStockCards();
            });

            card.addEventListener('click', () => { handleSelectTicker(data.ticker); });
        }

        root.appendChild(card);

        if (data && data.historicalData) {
            setTimeout(() => renderChart(data.ticker, data), 120);
        }
    });
}

function renderChart(ticker, data) {
    const canvas = document.getElementById(`chart-${ticker}`);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    if (state.charts[ticker]) {
        try { state.charts[ticker].destroy(); } catch (e) {}
    }

    const isPositive = (data.change || 0) >= 0;
    const borderColor = isPositive ? 'rgba(0,255,136,1)' : 'rgba(255,77,77,1)';
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, isPositive ? 'rgba(0,255,136,0.15)' : 'rgba(255,77,77,0.12)');
    gradient.addColorStop(1, 'rgba(0,0,0,0)');

    state.charts[ticker] = new Chart(ctx, {
        type: 'line',
        data: {
            labels: (data.historicalData || []).map(d => d.time),
            datasets: [{
                data: (data.historicalData || []).map(d => d.price),
                borderColor,
                backgroundColor: gradient,
                fill: true,
                tension: 0.3,
                pointRadius: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: { callbacks: { label: (ctx) => `$${ctx.parsed.y.toFixed(2)}` } }
            },
            scales: { x: { display: false }, y: { display: false } }
        }
    });
}

/* ---------- Seed / Load logic ---------- */
function generateFallbackHistorical(currentPrice) {
    const arr = [];
    let price = currentPrice || 100;
    for (let i = 0; i < 30; i++) {
        price = price + (Math.random() - 0.5) * (currentPrice * 0.01);
        arr.push({ time: `${i}`, price: Math.max(price, 1) });
    }
    return arr;
}

async function seedStockData(ticker) {
    try {
        const [fhQuote, sdQuote] = await Promise.all([
            finnhubQuote(ticker).catch(() => null),
            stockdataQuote(ticker).catch(() => null)
        ]);

        let currentPrice = null;
        let prevClose = null;
        let volume = null;
        let marketCap = null;

        if (sdQuote && sdQuote.price != null) {
            currentPrice = sdQuote.price;
            prevClose = sdQuote.previous_close_price ?? sdQuote.prev_close ?? sdQuote.previous_close_price;
            volume = sdQuote.volume ?? sdQuote.v;
            marketCap = sdQuote.market_cap ?? sdQuote.market_capitalization;
        }
        if ((!currentPrice || currentPrice === 0) && fhQuote && fhQuote.c != null) {
            currentPrice = fhQuote.c;
            prevClose = prevClose || fhQuote.pc;
            volume = volume || fhQuote.v;
        }

        if (!currentPrice || currentPrice === 0) {
            currentPrice = state.stockData[ticker]?.price || 100;
            console.warn(`Using fallback price for ${ticker}: ${currentPrice}`);
        }

        let candles = await finnhubCandles(ticker, '5', 180);
        if (!candles || candles.length === 0) {
            candles = await finnhubCandles(ticker, '15', 360);
        }
        if (!candles || candles.length === 0) {
            candles = (state.stockData[ticker]?.historicalData) || generateFallbackHistorical(currentPrice || 100);
        }

        const eod = await stockdataEOD(ticker).catch(() => []);
        const eodPrices = eod && eod.length ? eod.map(d => d.close).filter(v => v != null) : [];
        
        // Use ML prediction if available
        const allPrices = eodPrices.length > 30 ? eodPrices : (candles||[]).map(c=>c.price);
        const prediction = await calculatePredictionWithML(allPrices, ticker);

        const change = (currentPrice != null && prevClose != null) ? (currentPrice - prevClose) : ((state.stockData[ticker] && state.stockData[ticker].change) || 0);
        const changePercent = prevClose ? (change / prevClose) * 100 : (state.stockData[ticker]?.changePercent || 0);

        state.stockData[ticker] = {
            ticker,
            name: state.stockData[ticker]?.name || ticker,
            price: currentPrice != null ? currentPrice : (state.stockData[ticker]?.price || 0),
            previousClose: prevClose,
            change,
            changePercent,
            volume,
            marketCap,
            historicalData: candles,
            eodHistory: eod,
            prediction,
            lastUpdate: new Date()
        };

        state.lastUpdate = new Date();
        updateLastUpdateTime();
        return state.stockData[ticker];
    } catch (err) {
        console.warn('seedStockData error', err);
        state.useFallback = true;
        if (!state.stockData[ticker]) {
            state.stockData[ticker] = {
                ticker,
                name: ticker,
                price: 100,
                change: 0,
                changePercent: 0,
                volume: 0,
                marketCap: null,
                historicalData: generateFallbackHistorical(100),
                prediction: null,
                lastUpdate: new Date()
            };
        }
        return state.stockData[ticker];
    }
}

/* ---------- Stock Details Page ---------- */
let newsAggregator = null;

function initializeNewsAggregator() {
    if (window.NewsAggregator) {
        newsAggregator = new NewsAggregator();
        console.log('News Aggregator initialized with sources:', newsAggregator.getActiveSources());
    } else {
        console.warn('NewsAggregator not loaded');
    }
}

async function showStockDetailView(ticker) {
    // Hide main grid, show detail view
    document.getElementById('stockGrid').style.display = 'none';
    document.getElementById('stockDetailView').style.display = 'grid';
    document.getElementById('backToDashboard').style.display = 'block';
    
    // Load stock data
    await loadStockDetailData(ticker);
    loadWatchlistSidebar();
    loadStockNewsDetail(ticker);
}

function hideStockDetailView() {
    // Hide detail view
    document.getElementById('stockDetailView').style.display = 'none';
    document.getElementById('backToDashboard').style.display = 'none';
    
    // Show main dashboard
    document.getElementById('stockGrid').style.display = 'grid';
}

async function loadStockDetailData(ticker) {
    const data = state.stockData[ticker];
    if (!data) {
        await seedStockData(ticker);
    }
    
    const currentData = state.stockData[ticker];
    
    // Update header
    document.getElementById('detailStockSymbol').textContent = ticker;
    document.getElementById('detailCurrentPrice').textContent = `$${currentData.price?.toFixed(2) || 'N/A'}`;
    
    // Update price change
    const changeElement = document.getElementById('detailPriceChange');
    const isPositive = (currentData.change || 0) >= 0;
    changeElement.innerHTML = `
        <span style="color: ${isPositive ? 'var(--accent-bull)' : 'var(--accent-bear)'}">
            ${isPositive ? '+' : ''}${currentData.changePercent?.toFixed(2) || '0.00'}%
        </span>
        <span class="change-amount">
            (${isPositive ? '+' : ''}$${currentData.change?.toFixed(2) || '0.00'})
        </span>
    `;
    
    // Load chart
    renderDetailChart(ticker, currentData);
    
    // Load overview data
    updateOverviewTab(currentData);
    
    // Load predictions
    updatePredictionsTab(currentData);
    
    // Set up tab switching
    setupTabSwitching();
    
    // Set up chart period switching
    setupChartPeriods(ticker);
}

function setupTabSwitching() {
    document.querySelectorAll('.tab-button').forEach(button => {
        button.addEventListener('click', function() {
            // Remove active class from all tabs
            document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
            document.querySelectorAll('.tab-pane').forEach(pane => pane.classList.remove('active'));
            
            // Add active class to clicked tab
            this.classList.add('active');
            const tabName = this.getAttribute('data-tab');
            const tabElement = document.getElementById(`${tabName}Tab`);
            if (tabElement) {
                tabElement.classList.add('active');
            }
        });
    });
}

function setupChartPeriods(ticker) {
    document.querySelectorAll('.period-btn').forEach(button => {
        button.addEventListener('click', function() {
            // Remove active class from all buttons
            document.querySelectorAll('.period-btn').forEach(btn => btn.classList.remove('active'));
            
            // Add active class to clicked button
            this.classList.add('active');
            
            const period = this.getAttribute('data-period');
            loadChartForPeriod(ticker, period);
        });
    });
}

function renderDetailChart(ticker, data) {
    const canvas = document.getElementById('detailChart');
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    const isPositive = (data.change || 0) >= 0;
    
    // Destroy existing chart if any
    if (state.charts[`${ticker}_detail`]) {
        try { state.charts[`${ticker}_detail`].destroy(); } catch (e) {}
    }
    
    const chartData = data.historicalData || [];
    const labels = chartData.map(d => d.time);
    const prices = chartData.map(d => d.price);
    
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, isPositive ? 'rgba(0,255,136,0.2)' : 'rgba(255,77,77,0.2)');
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    
    state.charts[`${ticker}_detail`] = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Price',
                data: prices,
                borderColor: isPositive ? 'var(--accent-bull)' : 'var(--accent-bear)',
                backgroundColor: gradient,
                fill: true,
                tension: 0.4,
                pointRadius: 2,
                pointBackgroundColor: isPositive ? 'var(--accent-bull)' : 'var(--accent-bear)',
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    callbacks: {
                        label: (context) => `$${context.parsed.y.toFixed(2)}`
                    }
                }
            },
            scales: {
                x: {
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    ticks: { color: 'var(--text-secondary)' }
                },
                y: {
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    ticks: { 
                        color: 'var(--text-secondary)',
                        callback: function(value) {
                            return '$' + value.toFixed(2);
                        }
                    }
                }
            }
        }
    });
}

async function loadChartForPeriod(ticker, period) {
    // This function would fetch data for different time periods
    console.log(`Loading ${period} chart for ${ticker}`);
    // Implement API calls for different time periods here
}

function updateOverviewTab(data) {
    const overviewGrid = document.getElementById('overviewGrid');
    if (!overviewGrid) return;
    
    overviewGrid.innerHTML = `
        <div class="overview-stat">
            <div class="overview-stat-label">Market Cap</div>
            <div class="overview-stat-value">${formatNumber(data.marketCap)}</div>
        </div>
        <div class="overview-stat">
            <div class="overview-stat-label">Volume</div>
            <div class="overview-stat-value">${formatNumber(data.volume)}</div>
        </div>
        <div class="overview-stat">
            <div class="overview-stat-label">Previous Close</div>
            <div class="overview-stat-value">$${data.previousClose?.toFixed(2) || 'N/A'}</div>
        </div>
        <div class="overview-stat">
            <div class="overview-stat-label">Day Range</div>
            <div class="overview-stat-value">$${data.dayLow?.toFixed(2) || 'N/A'} - $${data.dayHigh?.toFixed(2) || 'N/A'}</div>
        </div>
    `;
}

function updatePredictionsTab(data) {
    const predictionCard = document.getElementById('predictionCard');
    if (!predictionCard) return;
    
    if (!data.prediction) {
        predictionCard.innerHTML = `<p>No prediction available</p>`;
        return;
    }
    
    predictionCard.innerHTML = `
        <div class="prediction-header">
            <i class="fas fa-brain"></i>
            AI Prediction
            <span class="prediction-badge">${data.prediction.method === 'ml-lstm' ? 'ML Model' : 'Statistical'}</span>
        </div>
        <div class="prediction-price">$${data.prediction.predictedPrice.toFixed(2)}</div>
        <div class="prediction-metrics">
            <div class="prediction-metric">
                <div class="prediction-metric-label">Confidence</div>
                <div class="prediction-metric-value">${data.prediction.confidence}%</div>
            </div>
            <div class="prediction-metric">
                <div class="prediction-metric-label">Direction</div>
                <div class="prediction-metric-value" style="color: ${data.prediction.direction === 'up' ? 'var(--accent-bull)' : 'var(--accent-bear)'}">
                    ${data.prediction.direction === 'up' ? 'Bullish ▲' : 'Bearish ▼'}
                </div>
            </div>
            <div class="prediction-metric">
                <div class="prediction-metric-label">Volatility</div>
                <div class="prediction-metric-value">${data.prediction.volatility?.toFixed(2) || 'N/A'}</div>
            </div>
        </div>
    `;
}

function loadWatchlistSidebar() {
    const watchlistContent = document.getElementById('watchlistContent');
    if (!watchlistContent) return;
    
    watchlistContent.innerHTML = '';
    
    CONFIG.stocks.forEach(ticker => {
        const data = state.stockData[ticker];
        if (!data) return;
        
        const isPositive = (data.change || 0) >= 0;
        const isActive = state.selectedStock === ticker;
        
        const item = document.createElement('div');
        item.className = `watchlist-item ${isActive ? 'active' : ''}`;
        item.onclick = () => showStockDetailView(ticker);
        
        item.innerHTML = `
            <div class="watchlist-item-header">
                <div class="watchlist-symbol">${ticker}</div>
                <div class="watchlist-change" style="color: ${isPositive ? 'var(--accent-bull)' : 'var(--accent-bear)'}">
                    ${isPositive ? '+' : ''}${data.changePercent?.toFixed(2) || '0.00'}%
                </div>
            </div>
            <div class="watchlist-sector">${data.name || ticker}</div>
            <div class="watchlist-footer">
                <div class="watchlist-price">$${data.price?.toFixed(2) || 'N/A'}</div>
                <div class="watchlist-change" style="color: ${isPositive ? 'var(--accent-bull)' : 'var(--accent-bear)'}">
                    ${isPositive ? '+' : ''}$${data.change?.toFixed(2) || '0.00'}
                </div>
            </div>
        `;
        
        watchlistContent.appendChild(item);
    });
}

async function loadStockNewsDetail(ticker) {
    const newsContent = document.getElementById('newsContentDetail');
    if (!newsContent) return;
    
    newsContent.innerHTML = `
        <div class="news-loading">
            <div class="spinner"></div>
            <p>Fetching news from multiple sources...</p>
        </div>
    `;
    
    try {
        const articles = await newsAggregator.fetchNewsForStock(ticker, state.stockData[ticker]?.name);
        renderNewsDetail(articles);
        
        // Update active sources count
        const activeSources = newsAggregator.getActiveSources();
        document.getElementById('activeSourcesCount').textContent = `${activeSources.length} active sources`;
        
        // Set up news search
        setupNewsSearch(articles);
        
    } catch (error) {
        console.error('Error loading news:', error);
        newsContent.innerHTML = `
            <div class="news-loading">
                <i class="fas fa-exclamation-triangle"></i>
                <p>Failed to load news. Please try again.</p>
            </div>
        `;
    }
}

function renderNewsDetail(articles) {
    const newsContent = document.getElementById('newsContentDetail');
    if (!newsContent) return;
    
    if (!articles || articles.length === 0) {
        newsContent.innerHTML = `
            <div class="news-loading">
                <i class="far fa-newspaper"></i>
                <p>No news articles found for this stock.</p>
            </div>
        `;
        return;
    }
    
    newsContent.innerHTML = articles.map((article, idx) => `
        <div class="news-article" onclick="window.open('${article.url}', '_blank')">
            ${article.urlToImage ? `
                <img src="${article.urlToImage}" 
                     alt="${article.title || 'News image'}" 
                     class="news-article-image"
                     onerror="this.style.display='none'">
            ` : ''}
            
            <div class="news-article-title">${article.title || 'Untitled'}</div>
            
            ${article.description ? `
                <div class="news-article-description">
                    ${article.description}
                </div>
            ` : ''}
            
            <div class="news-article-meta">
                <span class="news-source">${article.source?.name || article._source || 'Unknown'}</span>
                <span class="news-date">${new Date(article.publishedAt || article.published_at || Date.now()).toLocaleDateString()}</span>
            </div>
            
            ${article._relevance ? `
                <div class="news-relevance-badge">
                    <i class="fas fa-bolt"></i>
                    ${article._relevance}% relevant
                </div>
            ` : ''}
        </div>
    `).join('');
}

function setupNewsSearch(allArticles) {
    const searchInput = document.getElementById('newsSearchInput');
    if (!searchInput) return;
    
    searchInput.addEventListener('input', function(e) {
        const searchTerm = e.target.value.toLowerCase().trim();
        
        if (!searchTerm) {
            renderNewsDetail(allArticles);
            return;
        }
        
        const filteredArticles = allArticles.filter(article => {
            const searchableText = `
                ${article.title || ''} 
                ${article.description || ''} 
                ${article.source?.name || ''}
            `.toLowerCase();
            
            return searchableText.includes(searchTerm);
        });
        
        renderNewsDetail(filteredArticles);
    });
}

/* ---------- Search & Autocomplete ---------- */
const autocompleteRoot = document.getElementById('autocompleteList');
let autocompleteTimer = null;

if (document.getElementById('searchInput')) {
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.addEventListener('input', async (e) => {
            const q = e.target.value.trim();
            if (!q) { if (autocompleteRoot) autocompleteRoot.style.display = 'none'; return; }
            if (autocompleteTimer) clearTimeout(autocompleteTimer);
            autocompleteTimer = setTimeout(async () => {
                const results = await finnhubSearch(q);
                if (!results || results.length === 0) { if (autocompleteRoot) autocompleteRoot.style.display = 'none'; return; }
                if (!autocompleteRoot) return;
                autocompleteRoot.innerHTML = results.slice(0, 8).map(r => `
                    <div class="autocomplete-item" data-symbol="${r.symbol}">
                        <div>
                            <div class="symbol">${r.symbol}</div>
                            <div class="desc">${r.description || ''}</div>
                        </div>
                        <div style="color:var(--text-muted);font-size:0.85rem">${r.type || ''}</div>
                    </div>
                `).join('');
                autocompleteRoot.querySelectorAll('.autocomplete-item').forEach(item => {
                    item.addEventListener('click', () => {
                        const sym = item.getAttribute('data-symbol');
                        const input = document.getElementById('searchInput');
                        if (input) input.value = sym;
                        if (autocompleteRoot) autocompleteRoot.style.display = 'none';
                        handleSearchSymbol(sym);
                    });
                });
                autocompleteRoot.style.display = 'block';
            }, 250);
        });
    }
}

/* ---------- Handle Search Symbol ---------- */
async function handleSearchSymbol(symbol) {
    if (!symbol) return;
    
    // Add to search history
    if (!state.searchHistory.includes(symbol)) {
        state.searchHistory.push(symbol);
        if (state.searchHistory.length > 20) state.searchHistory.shift();
        renderHistoryAndPinned();
    }
    
    // Check if already in stock list
    if (CONFIG.stocks.includes(symbol)) {
        handleSelectTicker(symbol);
    } else {
        // Add to config and load
        if (!CONFIG.stocks.includes(symbol)) {
            CONFIG.stocks.push(symbol);
        }
        await seedStockData(symbol);
        renderStockCards();
        handleSelectTicker(symbol);
    }
}

/* ---------- Handle Select Ticker ---------- */
async function handleSelectTicker(ticker) {
    state.selectedStock = ticker;
    await showStockDetailView(ticker);
}

/* ---------- WebSocket ---------- */
let finnhubSocket = null;
let reconnectAttempts = 0;

function updateLiveIndicator(isLive) {
    const el = document.getElementById('liveIndicator');
    if (!el) return;
    if (isLive) { el.textContent = '• Live'; el.style.color = '#00ff88'; }
    else { el.textContent = '• Offline (polling)'; el.style.color = '#ffd700'; }
}

function setupFinnhubSocket() {
    const key = CONFIG.FINNHUB_KEY;
    if (!key || key === 'YOUR_FINNHUB_KEY') {
        console.warn('Finnhub key not set. WebSocket disabled.');
        updateLiveIndicator(false);
        return;
    }
    try {
        finnhubSocket = new WebSocket(`wss://ws.finnhub.io?token=${key}`);

        finnhubSocket.addEventListener('open', () => {
            console.log('Finnhub WS connected');
            state.wsConnected = true;
            reconnectAttempts = 0;
            updateLiveIndicator(true);
            state.wsSubscribed.forEach(sym => {
                try { finnhubSocket.send(JSON.stringify({ type: 'subscribe', symbol: sym })); } catch (e) {}
            });
        });

        finnhubSocket.addEventListener('message', (ev) => {
            try {
                const msg = JSON.parse(ev.data);
                if (msg.type === 'trade' && msg.data && msg.data.length) {
                    msg.data.forEach(tr => {
                        const symbol = tr.s;
                        const price = tr.p;
                        const ts = tr.t;
                        if (!state.stockData[symbol]) {
                            state.stockData[symbol] = { ticker: symbol, price, historicalData: [{ time: new Date(ts).toLocaleTimeString(), price }], prediction: null, change: 0, changePercent: 0, previousClose: null };
                        } else {
                            const sd = state.stockData[symbol];
                            sd.price = price;
                            sd.lastUpdate = new Date(ts);
                            const nowLabel = new Date(ts).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
                            const hd = sd.historicalData || [];
                            hd.push({ time: nowLabel, price });
                            if (hd.length > 80) hd.shift();
                            sd.historicalData = hd;
                            if (sd.previousClose) {
                                sd.change = sd.price - sd.previousClose;
                                sd.changePercent = sd.previousClose ? (sd.change / sd.previousClose) * 100 : 0;
                            }
                            state.stockData[symbol] = sd;
                        }
                        // Update chart if viewing this stock
                        if (state.selectedStock === symbol && state.charts[`${symbol}_detail`]) {
                            renderDetailChart(symbol, state.stockData[symbol]);
                        }
                    });
                }
            } catch (err) {
                console.error('WS parse error', err);
            }
        });

        finnhubSocket.addEventListener('close', () => {
            console.warn('Finnhub WS closed');
            state.wsConnected = false;
            updateLiveIndicator(false);
            // Try to reconnect
            setTimeout(setupFinnhubSocket, 5000);
        });

        finnhubSocket.addEventListener('error', (err) => {
            console.error('WebSocket error:', err);
        });

    } catch (error) {
        console.error('Error setting up WebSocket:', error);
    }
}

/* ---------- Initialize Application ---------- */
document.addEventListener('DOMContentLoaded', async function() {
    console.log('Initializing AI Stock Predictor...');
    
    // Initialize ML predictor
    await initializeMLPredictor();
    
    // Initialize News Aggregator
    initializeNewsAggregator();
    
    // Set up search button
    const searchBtn = document.getElementById('searchBtn');
    if (searchBtn) {
        searchBtn.addEventListener('click', () => {
            const input = document.getElementById('searchInput');
            if (input && input.value.trim()) {
                handleSearchSymbol(input.value.trim());
            }
        });
    }
    
    // Set up refresh button
    const refreshBtn = document.getElementById('refreshBtn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', async () => {
            state.isLoading = true;
            for (const ticker of CONFIG.stocks) {
                await seedStockData(ticker);
            }
            renderStockCards();
            state.isLoading = false;
            state.lastUpdate = new Date();
            updateLastUpdateTime();
        });
    }
    
    // Set up back button
    const backBtn = document.getElementById('backToDashboard');
    if (backBtn) {
        backBtn.querySelector('button').addEventListener('click', hideStockDetailView);
    }
    
    // Initialize WebSocket
    setupFinnhubSocket();
    
    // Load initial data
    console.log('Loading initial stock data...');
    state.isLoading = true;
    
    const promises = CONFIG.stocks.map(ticker => seedStockData(ticker));
    await Promise.all(promises);
    
    renderStockCards();
    renderHistoryAndPinned();
    state.isLoading = false;
    state.lastUpdate = new Date();
    updateLastUpdateTime();
    
    console.log('Application initialized successfully!');
    
    // Set up auto-refresh
    setInterval(async () => {
        if (!state.isLoading) {
            for (const ticker of CONFIG.stocks) {
                await seedStockData(ticker);
            }
            renderStockCards();
            state.lastUpdate = new Date();
            updateLastUpdateTime();
        }
    }, CONFIG.refreshInterval);
});