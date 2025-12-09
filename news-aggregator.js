// news-aggregator.js - Multi-source News Aggregation with ML Filtering

class NewsAggregator {
    constructor() {
        this.newsSources = [
            {
                name: 'NewsAPI',
                key: '06e8ae8f37b549a5bb8727f9e46bbfc3',
                url: 'https://newsapi.org/v2/everything',
                enabled: true
            },
            {
                name: 'StockData',
                key: 'H9IuvBwPXRLWDdJhnia5uwDsujNk106qGLyL3yW4',
                url: 'https://api.stockdata.org/v1/news/all',
                enabled: true
            },
            {
                name: 'Finnhub',
                key: 'd4ivcg1r01queuakp4pgd4ivcg1r01queuakp4q0',
                url: 'https://finnhub.io/api/v1/news',
                enabled: true
            },
            // Add more API keys here as you get them
            {
                name: 'AlphaVantage',
                key: 'demo', // Replace with your key
                url: 'https://www.alphavantage.co/query',
                enabled: false // Set to true when you have a key
            },
            {
                name: 'Polygon',
                key: 'demo', // Replace with your key
                url: 'https://api.polygon.io/v2/reference/news',
                enabled: false // Set to true when you have a key
            }
        ];
        
        this.newsCache = new Map();
        this.cacheDuration = 5 * 60 * 1000; // 5 minutes
    }

    // ML-based relevance scoring
    calculateRelevanceScore(article, symbol, companyName) {
        let score = 0;
        const text = `${article.title || ''} ${article.description || ''} ${article.content || ''}`.toLowerCase();
        const symbolLower = symbol.toLowerCase();
        const companyWords = companyName ? companyName.toLowerCase().split(' ') : [];
        
        // Keyword matching
        if (text.includes(symbolLower)) score += 30;
        if (companyWords.some(word => text.includes(word))) score += 20;
        
        // Financial keywords
        const financialKeywords = [
            'stock', 'market', 'earnings', 'revenue', 'profit', 'dividend',
            'quarterly', 'annual', 'forecast', 'target', 'price', 'analyst',
            'upgrade', 'downgrade', 'maintain', 'outperform', 'hold', 'sell'
        ];
        
        financialKeywords.forEach(keyword => {
            if (text.includes(keyword)) score += 5;
        });
        
        // Recency bonus (within 24 hours)
        const articleDate = new Date(article.publishedAt || article.published_at || Date.now());
        const hoursAgo = (Date.now() - articleDate.getTime()) / (1000 * 60 * 60);
        if (hoursAgo < 24) score += 15;
        if (hoursAgo < 2) score += 10;
        
        // Source credibility
        const credibleSources = ['bloomberg', 'reuters', 'wsj', 'financial times', 'cnbc', 'yahoo finance'];
        const sourceName = (article.source?.name || article.source || '').toLowerCase();
        if (credibleSources.some(src => sourceName.includes(src))) score += 10;
        
        return Math.min(100, score);
    }

    async fetchFromNewsAPI(symbol, companyName) {
        const source = this.newsSources.find(s => s.name === 'NewsAPI');
        if (!source.enabled) return [];
        
        try {
            const url = `${source.url}?q=${encodeURIComponent(symbol)} OR ${encodeURIComponent(companyName)}&language=en&sortBy=relevancy&pageSize=15&apiKey=${source.key}`;
            const response = await fetch(url);
            if (!response.ok) throw new Error('NewsAPI failed');
            
            const data = await response.json();
            return data.articles?.map(article => ({
                ...article,
                _source: 'NewsAPI',
                _relevance: this.calculateRelevanceScore(article, symbol, companyName)
            })) || [];
        } catch (error) {
            console.warn('NewsAPI error:', error);
            return [];
        }
    }

    async fetchFromStockData(symbol) {
        const source = this.newsSources.find(s => s.name === 'StockData');
        if (!source.enabled) return [];
        
        try {
            const url = `${source.url}?symbols=${encodeURIComponent(symbol)}&filter_entities=true&limit=15&api_token=${source.key}`;
            const response = await fetch(url);
            if (!response.ok) throw new Error('StockData failed');
            
            const data = await response.json();
            return data.data?.map(article => ({
                title: article.title,
                description: article.description,
                url: article.url,
                urlToImage: article.image_url,
                publishedAt: article.published_at,
                source: { name: article.source },
                _source: 'StockData',
                _relevance: this.calculateRelevanceScore(article, symbol, '')
            })) || [];
        } catch (error) {
            console.warn('StockData error:', error);
            return [];
        }
    }

    async fetchFromFinnhub(symbol) {
        const source = this.newsSources.find(s => s.name === 'Finnhub');
        if (!source.enabled) return [];
        
        try {
            const url = `${source.url}?symbol=${encodeURIComponent(symbol)}&token=${source.key}`;
            const response = await fetch(url);
            if (!response.ok) throw new Error('Finnhub failed');
            
            const data = await response.json();
            return data?.map(article => ({
                title: article.headline,
                description: article.summary,
                url: article.url,
                urlToImage: article.image,
                publishedAt: new Date(article.datetime * 1000).toISOString(),
                source: { name: article.source },
                _source: 'Finnhub',
                _relevance: this.calculateRelevanceScore({
                    title: article.headline,
                    description: article.summary
                }, symbol, '')
            })) || [];
        } catch (error) {
            console.warn('Finnhub error:', error);
            return [];
        }
    }

    // Deduplicate articles based on title similarity
    deduplicateArticles(articles) {
        const seenTitles = new Set();
        const uniqueArticles = [];
        
        articles.sort((a, b) => b._relevance - a._relevance);
        
        for (const article of articles) {
            const title = article.title?.toLowerCase().trim();
            if (!title) continue;
            
            // Simple deduplication by exact title match
            if (!seenTitles.has(title)) {
                seenTitles.add(title);
                uniqueArticles.push(article);
            }
        }
        
        return uniqueArticles;
    }

    async fetchNewsForStock(symbol, companyName = '') {
        const cacheKey = `${symbol}-${companyName}`;
        const cached = this.newsCache.get(cacheKey);
        
        if (cached && Date.now() - cached.timestamp < this.cacheDuration) {
            return cached.articles;
        }
        
        console.log(`Fetching news for ${symbol} from multiple sources...`);
        
        // Fetch from all enabled sources in parallel
        const promises = [
            this.fetchFromNewsAPI(symbol, companyName),
            this.fetchFromStockData(symbol),
            this.fetchFromFinnhub(symbol)
        ];
        
        const results = await Promise.allSettled(promises);
        let allArticles = [];
        
        results.forEach((result, index) => {
            if (result.status === 'fulfilled') {
                allArticles = allArticles.concat(result.value);
            }
        });
        
        // Sort by relevance and deduplicate
        allArticles.sort((a, b) => b._relevance - a._relevance);
        allArticles = this.deduplicateArticles(allArticles);
        
        // Cache the results
        this.newsCache.set(cacheKey, {
            articles: allArticles.slice(0, 20), // Limit to 20 articles
            timestamp: Date.now()
        });
        
        return allArticles.slice(0, 20);
    }

    getActiveSources() {
        return this.newsSources.filter(source => source.enabled).map(source => source.name);
    }
}

// Export for use in app.js
window.NewsAggregator = NewsAggregator;