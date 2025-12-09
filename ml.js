// ml-predictor.js - Advanced ML Stock Prediction Module
// Add this file to your project and include it in index.html after TensorFlow.js

class MLStockPredictor {
    constructor() {
        this.model = null;
        this.isModelReady = false;
        this.sequenceLength = 30; // Look back 30 data points
        this.featureCount = 8; // Number of technical indicators
    }

    // Calculate technical indicators
    calculateIndicators(prices) {
        if (!prices || prices.length < 20) return null;

        const indicators = {
            sma5: this.calculateSMA(prices, 5),
            sma10: this.calculateSMA(prices, 10),
            sma20: this.calculateSMA(prices, 20),
            ema12: this.calculateEMA(prices, 12),
            ema26: this.calculateEMA(prices, 26),
            rsi: this.calculateRSI(prices, 14),
            macd: this.calculateMACD(prices),
            volatility: this.calculateVolatility(prices, 20)
        };

        return indicators;
    }

    // Simple Moving Average
    calculateSMA(prices, period) {
        if (prices.length < period) return prices[prices.length - 1];
        const slice = prices.slice(-period);
        return slice.reduce((a, b) => a + b, 0) / period;
    }

    // Exponential Moving Average
    calculateEMA(prices, period) {
        if (prices.length < period) return prices[prices.length - 1];
        
        const multiplier = 2 / (period + 1);
        let ema = this.calculateSMA(prices.slice(0, period), period);
        
        for (let i = period; i < prices.length; i++) {
            ema = (prices[i] - ema) * multiplier + ema;
        }
        
        return ema;
    }

    // Relative Strength Index
    calculateRSI(prices, period = 14) {
        if (prices.length < period + 1) return 50;
        
        let gains = 0;
        let losses = 0;
        
        for (let i = prices.length - period; i < prices.length; i++) {
            const change = prices[i] - prices[i - 1];
            if (change > 0) gains += change;
            else losses -= change;
        }
        
        const avgGain = gains / period;
        const avgLoss = losses / period;
        
        if (avgLoss === 0) return 100;
        const rs = avgGain / avgLoss;
        return 100 - (100 / (1 + rs));
    }

    // MACD (Moving Average Convergence Divergence)
    calculateMACD(prices) {
        const ema12 = this.calculateEMA(prices, 12);
        const ema26 = this.calculateEMA(prices, 26);
        return ema12 - ema26;
    }

    // Volatility (Standard Deviation)
    calculateVolatility(prices, period = 20) {
        if (prices.length < period) return 0;
        
        const slice = prices.slice(-period);
        const mean = slice.reduce((a, b) => a + b, 0) / period;
        const variance = slice.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / period;
        return Math.sqrt(variance);
    }

    // Normalize data to 0-1 range
    normalize(data, min, max) {
        return (data - min) / (max - min);
    }

    // Prepare training data from historical prices
    prepareTrainingData(historicalPrices) {
        if (!historicalPrices || historicalPrices.length < this.sequenceLength + 20) {
            return null;
        }

        const sequences = [];
        const targets = [];

        // Create sequences with technical indicators
        for (let i = this.sequenceLength; i < historicalPrices.length; i++) {
            const priceWindow = historicalPrices.slice(i - this.sequenceLength, i);
            const indicators = this.calculateIndicators(priceWindow);
            
            if (!indicators) continue;

            // Normalize prices
            const minPrice = Math.min(...priceWindow);
            const maxPrice = Math.max(...priceWindow);
            
            // Create feature vector for each time step
            const sequence = priceWindow.map((price, idx) => {
                const normalizedPrice = this.normalize(price, minPrice, maxPrice);
                const windowForIndicators = priceWindow.slice(0, idx + 1);
                const ind = this.calculateIndicators(windowForIndicators) || indicators;
                
                return [
                    normalizedPrice,
                    this.normalize(ind.sma5 || price, minPrice, maxPrice),
                    this.normalize(ind.sma10 || price, minPrice, maxPrice),
                    this.normalize(ind.rsi || 50, 0, 100),
                    this.normalize(ind.macd || 0, -10, 10),
                    this.normalize(ind.ema12 || price, minPrice, maxPrice),
                    this.normalize(ind.ema26 || price, minPrice, maxPrice),
                    this.normalize(ind.volatility || 0, 0, maxPrice * 0.1)
                ];
            });

            // Target is the next price (normalized)
            const targetPrice = historicalPrices[i];
            const normalizedTarget = this.normalize(targetPrice, minPrice, maxPrice);
            
            sequences.push(sequence);
            targets.push(normalizedTarget);
        }

        return { sequences, targets, minPrice: Math.min(...historicalPrices), maxPrice: Math.max(...historicalPrices) };
    }

    // Create and compile LSTM model
    async createModel() {
        if (!window.tf) {
            console.error('TensorFlow.js not loaded');
            return;
        }

        const model = tf.sequential();

        // LSTM layers for time series prediction
        model.add(tf.layers.lstm({
            units: 64,
            returnSequences: true,
            inputShape: [this.sequenceLength, this.featureCount]
        }));
        
        model.add(tf.layers.dropout({ rate: 0.2 }));

        model.add(tf.layers.lstm({
            units: 32,
            returnSequences: false
        }));
        
        model.add(tf.layers.dropout({ rate: 0.2 }));

        model.add(tf.layers.dense({ units: 16, activation: 'relu' }));
        model.add(tf.layers.dense({ units: 1, activation: 'sigmoid' }));

        model.compile({
            optimizer: tf.train.adam(0.001),
            loss: 'meanSquaredError',
            metrics: ['mae']
        });

        this.model = model;
        return model;
    }

    // Train the model
    async trainModel(historicalPrices, epochs = 50) {
        try {
            console.log('Preparing training data...');
            const trainingData = this.prepareTrainingData(historicalPrices);
            
            if (!trainingData || trainingData.sequences.length < 10) {
                console.warn('Insufficient training data');
                return { success: false, error: 'Insufficient data' };
            }

            if (!this.model) {
                await this.createModel();
            }

            console.log(`Training with ${trainingData.sequences.length} samples...`);

            // Convert to tensors
            const xs = tf.tensor3d(trainingData.sequences);
            const ys = tf.tensor2d(trainingData.targets, [trainingData.targets.length, 1]);

            // Train the model
            const history = await this.model.fit(xs, ys, {
                epochs: epochs,
                batchSize: 32,
                validationSplit: 0.2,
                shuffle: true,
                verbose: 0,
                callbacks: {
                    onEpochEnd: (epoch, logs) => {
                        if (epoch % 10 === 0) {
                            console.log(`Epoch ${epoch}: loss = ${logs.loss.toFixed(4)}, mae = ${logs.mae.toFixed(4)}`);
                        }
                    }
                }
            });

            // Clean up tensors
            xs.dispose();
            ys.dispose();

            this.isModelReady = true;
            console.log('Model training complete!');

            return {
                success: true,
                finalLoss: history.history.loss[history.history.loss.length - 1],
                finalMAE: history.history.mae[history.history.mae.length - 1]
            };

        } catch (error) {
            console.error('Training error:', error);
            return { success: false, error: error.message };
        }
    }

    // Make prediction
    async predict(historicalPrices) {
        if (!this.model || !this.isModelReady) {
            console.warn('Model not ready, using fallback prediction');
            return this.fallbackPredict(historicalPrices);
        }

        try {
            if (historicalPrices.length < this.sequenceLength + 20) {
                return this.fallbackPredict(historicalPrices);
            }

            // Prepare input sequence
            const priceWindow = historicalPrices.slice(-this.sequenceLength);
            const minPrice = Math.min(...priceWindow);
            const maxPrice = Math.max(...priceWindow);

            const sequence = priceWindow.map((price, idx) => {
                const windowForIndicators = priceWindow.slice(0, idx + 1);
                const indicators = this.calculateIndicators(windowForIndicators);
                
                if (!indicators) {
                    return [this.normalize(price, minPrice, maxPrice), 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5];
                }

                return [
                    this.normalize(price, minPrice, maxPrice),
                    this.normalize(indicators.sma5, minPrice, maxPrice),
                    this.normalize(indicators.sma10, minPrice, maxPrice),
                    this.normalize(indicators.rsi, 0, 100),
                    this.normalize(indicators.macd, -10, 10),
                    this.normalize(indicators.ema12, minPrice, maxPrice),
                    this.normalize(indicators.ema26, minPrice, maxPrice),
                    this.normalize(indicators.volatility, 0, maxPrice * 0.1)
                ];
            });

            // Make prediction
            const inputTensor = tf.tensor3d([sequence]);
            const prediction = this.model.predict(inputTensor);
            const normalizedPrediction = await prediction.data();
            
            // Denormalize prediction
            const predictedPrice = normalizedPrediction[0] * (maxPrice - minPrice) + minPrice;

            // Clean up tensors
            inputTensor.dispose();
            prediction.dispose();

            // Calculate confidence based on model performance and volatility
            const currentPrice = historicalPrices[historicalPrices.length - 1];
            const indicators = this.calculateIndicators(historicalPrices);
            const volatility = indicators ? indicators.volatility : 0;
            const priceChange = Math.abs(predictedPrice - currentPrice);
            const volatilityRatio = volatility / currentPrice;
            
            // Higher volatility = lower confidence
            let confidence = Math.max(60, Math.min(95, 85 - (volatilityRatio * 1000)));

            // Adjust confidence based on prediction magnitude
            if (priceChange / currentPrice > 0.1) {
                confidence -= 10; // Large changes are less certain
            }

            return {
                predictedPrice: predictedPrice,
                confidence: Math.round(confidence * 10) / 10,
                direction: predictedPrice > currentPrice ? 'up' : 'down',
                volatility: volatility,
                indicators: indicators,
                method: 'ml-lstm'
            };

        } catch (error) {
            console.error('Prediction error:', error);
            return this.fallbackPredict(historicalPrices);
        }
    }

    // Fallback prediction (enhanced statistical method)
    fallbackPredict(prices) {
        if (!prices || prices.length < 5) return null;

        const indicators = this.calculateIndicators(prices);
        const recent = prices.slice(-10);
        const currentPrice = prices[prices.length - 1];
        
        // Calculate trend
        const trend = recent[recent.length - 1] - recent[0];
        const momentum = (recent.slice(-3).reduce((a, b) => a + b, 0) / 3) - 
                        (recent.slice(0, 3).reduce((a, b) => a + b, 0) / 3);
        
        // Weight multiple indicators
        let prediction = currentPrice;
        prediction += trend * 0.3;
        prediction += momentum * 0.2;
        
        if (indicators) {
            // Factor in RSI
            if (indicators.rsi > 70) prediction -= currentPrice * 0.02; // Overbought
            else if (indicators.rsi < 30) prediction += currentPrice * 0.02; // Oversold
            
            // Factor in MACD
            prediction += indicators.macd * 0.1;
        }

        const volatility = indicators ? indicators.volatility : 0;
        const confidence = Math.max(50, Math.min(85, 70 - (volatility / currentPrice) * 100));

        return {
            predictedPrice: prediction,
            confidence: Math.round(confidence * 10) / 10,
            direction: prediction > currentPrice ? 'up' : 'down',
            volatility: volatility,
            indicators: indicators,
            method: 'statistical'
        };
    }

    // Save model to browser storage
    async saveModel(modelName = 'stock-predictor') {
        if (!this.model) return false;
        
        try {
            await this.model.save(`indexeddb://${modelName}`);
            console.log('Model saved successfully');
            return true;
        } catch (error) {
            console.error('Error saving model:', error);
            return false;
        }
    }

    // Load model from browser storage
    async loadModel(modelName = 'stock-predictor') {
        try {
            this.model = await tf.loadLayersModel(`indexeddb://${modelName}`);
            this.isModelReady = true;
            console.log('Model loaded successfully');
            return true;
        } catch (error) {
            console.warn('Could not load saved model:', error);
            return false;
        }
    }
}

// Export for use in app.js
window.MLStockPredictor = MLStockPredictor;