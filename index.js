const WebSocket = require('ws');
const { Octokit } = require('@octokit/rest');
const fs = require('fs');

class MinecraftWorldChecker {
    constructor(config) {
        this.config = config;
        this.ws = null;
        this.reconnectInterval = 30000; // 30秒
        this.checkInterval = 60000; // 1分
        this.currentStatus = null;
        
        // GitHub API設定
        this.octokit = new Octokit({
            auth: config.github.token
        });
        
        this.init();
    }
    
    init() {
        this.connectWebSocket();
        setInterval(() => {
            this.checkWorldStatus();
        }, this.checkInterval);
    }
    
    connectWebSocket() {
        try {
            // Minecraft統合版のWebSocket接続はローカルホストまたは直接IPを使用
            // Renderから外部のMinecraftサーバーには直接接続できない可能性があります
            const wsUrl = `ws://localhost:${this.config.minecraft.port}`;
            console.log(`WebSocket接続試行: ${wsUrl}`);
            
            this.ws = new WebSocket(wsUrl);
            
            this.ws.on('open', () => {
                console.log('WebSocket接続成功');
                // Minecraft統合版用の初期化
                this.initializeMinecraftConnection();
            });
            
            this.ws.on('message', (data) => {
                try {
                    const message = JSON.parse(data.toString());
                    this.handleMessage(message);
                } catch (error) {
                    console.error('メッセージパースエラー:', error);
                }
            });
            
            this.ws.on('close', (code, reason) => {
                console.log(`WebSocket切断 (${code}): ${reason} - 再接続中...`);
                setTimeout(() => this.connectWebSocket(), this.reconnectInterval);
            });
            
            this.ws.on('error', (error) => {
                console.error('WebSocket エラー:', error);
                // 接続が失敗した場合は代替手段を試行
                this.tryAlternativeConnection();
            });
            
        } catch (error) {
            console.error('WebSocket接続失敗:', error);
            this.tryAlternativeConnection();
        }
    }
    
    sendCommand(command, eventName = null) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            const message = {
                header: {
                    requestId: this.generateRequestId(),
                    messagePurpose: command,
                    version: 1
                },
                body: eventName ? { eventName } : {}
            };
            
            this.ws.send(JSON.stringify(message));
        }
    }
    
    checkWorldStatus() {
        // scoreboardのmente値をチェック
        this.sendMinecraftCommand('testfor @e[name=Bananakundao,scores={mente=0}]');
        
        setTimeout(() => {
            this.sendMinecraftCommand('testfor @e[name=Bananakundao,scores={mente=1}]');
        }, 1000);
    }
    
    sendMinecraftCommand(command) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            const message = {
                header: {
                    requestId: this.generateRequestId(),
                    messagePurpose: "commandRequest",
                    version: 1
                },
                body: {
                    origin: {
                        type: "player"
                    },
                    commandLine: command,
                    version: 1
                }
            };
            
            this.ws.send(JSON.stringify(message));
        }
    }
    
    handleMessage(message) {
        try {
            if (message.body && message.body.eventName === 'PlayerMessage') {
                // チャットメッセージの処理（必要に応じて）
                return;
            }
            
            if (message.header && message.header.messagePurpose === 'commandResponse') {
                this.handleCommandResponse(message.body);
            }
        } catch (error) {
            console.error('メッセージ処理エラー:', error);
        }
    }
    
    handleCommandResponse(body) {
        if (!body || !body.statusMessage) return;
        
        let newStatus = null;
        
        // testforコマンドの結果を解析
        if (body.statusMessage.includes('Found')) {
            if (body.statusMessage.includes('score=0')) {
                newStatus = 'open'; // ワールドは開放中です
            } else if (body.statusMessage.includes('score=1')) {
                newStatus = 'maintenance'; // ワールドはメンテナンス中です
            }
        } else if (body.statusMessage.includes('No targets matched')) {
            newStatus = 'closed'; // ワールドは未開放です
        }
        
        if (newStatus && newStatus !== this.currentStatus) {
            this.currentStatus = newStatus;
            this.updateGitHubFile();
        }
    }
    
    async updateGitHubFile() {
        try {
            const statusData = {
                status: this.currentStatus,
                message: this.getStatusMessage(this.currentStatus),
                lastUpdated: new Date().toISOString(),
                timestamp: Date.now()
            };
            
            // 現在のファイルを取得
            let sha = null;
            try {
                const currentFile = await this.octokit.repos.getContent({
                    owner: this.config.github.owner,
                    repo: this.config.github.repo,
                    path: 'open.json'
                });
                sha = currentFile.data.sha;
            } catch (error) {
                // ファイルが存在しない場合は新規作成
                console.log('open.json が存在しないため新規作成します');
            }
            
            // ファイルを更新
            await this.octokit.repos.createOrUpdateFileContents({
                owner: this.config.github.owner,
                repo: this.config.github.repo,
                path: 'open.json',
                message: `Update world status: ${this.currentStatus}`,
                content: Buffer.from(JSON.stringify(statusData, null, 2)).toString('base64'),
                sha: sha
            });
            
            console.log(`GitHub更新完了: ${this.currentStatus} - ${this.getStatusMessage(this.currentStatus)}`);
            
        } catch (error) {
            console.error('GitHub更新エラー:', error);
        }
    }
    
    getStatusMessage(status) {
        switch (status) {
            case 'open':
                return 'ワールドは開放中です';
            case 'maintenance':
                return 'ワールドはメンテナンス中です';
            case 'closed':
            default:
                return 'ワールドは未開放です';
        }
    }
    
    generateRequestId() {
        return Math.random().toString(36).substring(2, 15);
    }
}

// 設定
const config = {
    minecraft: {
        host: 'sptr-world-open-check.onrender.com',
        port: 114514
    },
    github: {
        token: process.env.GITHUB_TOKEN, // 環境変数から取得
        owner: 'Banana-Niku87729', // GitHubユーザー名
        repo: 'MCSptr_WebSite'   // リポジトリ名
    }
};

// 起動
const checker = new MinecraftWorldChecker(config);

// エラーハンドリング
process.on('uncaughtException', (error) => {
    console.error('未処理エラー:', error);
});

process.on('unhandledRejection', (error) => {
    console.error('未処理Promise拒否:', error);
});
