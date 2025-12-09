// Interactive functionality for the finance dashboard

document.addEventListener('DOMContentLoaded', function() {
    // Stock cards hover effects
    const stockCards = document.querySelectorAll('.stock-card');
    
    stockCards.forEach(card => {
        card.addEventListener('mouseenter', function() {
            this.style.transform = 'translateY(-8px)';
        });
        
        card.addEventListener('mouseleave', function() {
            this.style.transform = 'translateY(0)';
        });
    });
    
    // Simulate live price updates
    function updateStockPrices() {
        const prices = document.querySelectorAll('.stock-price');
        const changes = document.querySelectorAll('.stock-change span');
        
        prices.forEach((price, index) => {
            const changeElement = changes[index];
            if (!changeElement) return;
            
            const current = parseFloat(price.textContent.replace('$', '').replace(',', ''));
            const changePercent = parseFloat(changeElement.textContent.replace('%', ''));
            
            // Only update occasionally (15% chance) for realism
            if (Math.random() < 0.15) {
                const randomChange = (Math.random() - 0.5) * 0.3; // Small random change
                const newPrice = current * (1 + randomChange / 100);
                const newChangePercent = changePercent + randomChange;
                
                // Update price
                price.textContent = '$' + newPrice.toFixed(2);
                
                // Update change
                changeElement.textContent = (newChangePercent > 0 ? '+' : '') + newChangePercent.toFixed(1) + '%';
                
                // Update change class
                const changeContainer = changeElement.parentElement;
                if (newChangePercent >= 0) {
                    changeContainer.className = 'stock-change change-positive';
                    changeContainer.innerHTML = '<i class="fas fa-arrow-up"></i><span>' + changeElement.textContent + '</span>';
                } else {
                    changeContainer.className = 'stock-change change-negative';
                    changeContainer.innerHTML = '<i class="fas fa-arrow-down"></i><span>' + changeElement.textContent + '</span>';
                }
            }
        });
    }
    
    // Update prices every 5 seconds
    setInterval(updateStockPrices, 5000);
    
    // Search functionality
    const searchInput = document.querySelector('.search-bar input');
    searchInput.addEventListener('keyup', function(e) {
        if (e.key === 'Enter') {
            const query = this.value.trim();
            if (query) {
                alert(`Searching for: ${query}`);
                this.value = '';
            }
        }
    });
    
    // Toggle sidebar on mobile
    function toggleSidebar() {
        const sidebar = document.querySelector('.sidebar');
        const mainContent = document.querySelector('.main-content');
        
        if (window.innerWidth <= 768) {
            if (sidebar.style.width === '70px' || !sidebar.style.width