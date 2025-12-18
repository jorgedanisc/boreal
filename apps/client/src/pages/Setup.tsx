import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { importVault } from '../lib/vault';
import { Lock, ArrowRight, Loader } from 'lucide-react';

export default function Setup() {
    const [code, setCode] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const navigate = useNavigate();

    const handleImport = async () => {
        if (!code) return;
        setLoading(true);
        setError(null);
        try {
            await importVault(code);
            navigate({ to: '/gallery' });
        } catch (e: any) {
            console.error(e);
            setError(e.message || 'Failed to import vault');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="text-foreground flex flex-col items-center justify-center p-4">
            <div className="w-full max-w-md space-y-8">
                <div className="text-center space-y-2">
                    <div className="w-16 h-16 bg-blue-500/10 rounded-2xl flex items-center justify-center mx-auto mb-6">
                        <Lock className="w-8 h-8 text-blue-400" />
                    </div>
                    <h1 className="text-3xl font-bold tracking-tight">Unlock Boreal</h1>
                    <p className="text-muted-foreground">Enter your Vault Code to access your memories.</p>
                </div>

                <div className="space-y-4">
                    <div className="space-y-2">
                        <textarea
                            value={code}
                            onChange={(e) => setCode(e.target.value)}
                            placeholder="Paste your vault code here..."
                            className="w-full h-32 bg-input border border-border rounded-lg p-3 text-sm font-mono focus:ring-2 focus:ring-ring focus:outline-none resize-none"
                        />
                    </div>

                    {error && (
                        <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm">
                            {error}
                        </div>
                    )}

                    <button
                        onClick={handleImport}
                        disabled={loading || !code}
                        className="w-full flex items-center justify-center gap-2 bg-primary hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed text-primary-foreground font-medium py-3 rounded-lg transition-colors"
                    >
                        {loading ? <Loader className="w-4 h-4 animate-spin" /> : <>Unlock Vault <ArrowRight className="w-4 h-4" /></>}
                    </button>

                    <p className="text-xs text-center text-muted-foreground">
                        Your credentials never leave this device except to talk to AWS.
                    </p>
                </div>
            </div>
        </div>
    );
}
