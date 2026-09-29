import React, { useRef } from 'react';
import { Image as ImageIcon, Type, Eye, Upload, X, Sparkles, CheckSquare, Square } from 'lucide-react';

export type PromptMode = 'image' | 'text' | 'multiview';

export interface MultiViewImages {
  front: string | null;
  back: string | null;
  left: string | null;
  right: string | null;
}

interface PromptSectionProps {
  mode: PromptMode;
  onModeChange: (mode: PromptMode) => void;
  imageUrl: string | null;
  onImageChange: (url: string | null) => void;
  textPrompt: string;
  onTextPromptChange: (text: string) => void;
  multiView: MultiViewImages;
  onMultiViewChange: (mv: MultiViewImages) => void;
  removeBackground: boolean;
  onRemoveBackgroundChange: (remove: boolean) => void;
  samplePrompts: string[];
}

export const PromptSection: React.FC<PromptSectionProps> = ({
  mode,
  onModeChange,
  imageUrl,
  onImageChange,
  textPrompt,
  onTextPromptChange,
  multiView,
  onMultiViewChange,
  removeBackground,
  onRemoveBackgroundChange,
  samplePrompts,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mvFrontRef = useRef<HTMLInputElement>(null);
  const mvBackRef = useRef<HTMLInputElement>(null);
  const mvLeftRef = useRef<HTMLInputElement>(null);
  const mvRightRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>, target: 'single' | 'front' | 'back' | 'left' | 'right') => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const result = event.target?.result as string;
      if (target === 'single') {
        onImageChange(result);
      } else {
        onMultiViewChange({
          ...multiView,
          [target]: result,
        });
      }
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 shadow-xl">
      {/* Mode Tabs */}
      <div className="flex border-b border-slate-800 pb-2 mb-4 gap-2">
        <button
          onClick={() => onModeChange('image')}
          className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold transition-all ${
            mode === 'image'
              ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/30'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
          }`}
        >
          <ImageIcon className="w-4 h-4" />
          <span>Image to 3D</span>
        </button>

        <button
          onClick={() => onModeChange('text')}
          className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold transition-all ${
            mode === 'text'
              ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/30'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
          }`}
        >
          <Type className="w-4 h-4" />
          <span>Text Prompt</span>
        </button>

        <button
          onClick={() => onModeChange('multiview')}
          className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold transition-all ${
            mode === 'multiview'
              ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/30'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
          }`}
        >
          <Eye className="w-4 h-4" />
          <span>Multi-View</span>
        </button>
      </div>

      {/* Single Image Mode */}
      {mode === 'image' && (
        <div className="space-y-3">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => handleFileUpload(e, 'single')}
          />

          {imageUrl ? (
            <div className="relative group rounded-lg overflow-hidden border border-slate-700 bg-slate-950 flex items-center justify-center h-48">
              <img
                src={imageUrl}
                alt="Prompt Reference"
                className="max-h-full max-w-full object-contain p-2"
              />
              <button
                onClick={() => onImageChange(null)}
                className="absolute top-2 right-2 p-1.5 rounded-full bg-slate-900/80 text-rose-400 hover:bg-rose-950/80 transition-colors border border-rose-900/50"
                title="Remove image"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-slate-700 hover:border-cyan-500/60 bg-slate-950/50 hover:bg-cyan-950/10 rounded-lg p-6 flex flex-col items-center justify-center cursor-pointer transition-all h-48 group text-center"
            >
              <div className="w-12 h-12 rounded-full bg-slate-800 flex items-center justify-center mb-2 group-hover:scale-110 group-hover:bg-cyan-950/60 transition-transform">
                <Upload className="w-6 h-6 text-slate-400 group-hover:text-cyan-400" />
              </div>
              <p className="text-sm font-medium text-slate-200">Upload reference image</p>
              <p className="text-xs text-slate-500 mt-1">PNG, JPG, or WEBP up to 20MB</p>
            </div>
          )}

          <div className="flex items-center justify-between pt-1">
            <label
              onClick={() => onRemoveBackgroundChange(!removeBackground)}
              className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer select-none"
            >
              {removeBackground ? (
                <CheckSquare className="w-4 h-4 text-cyan-400" />
              ) : (
                <Square className="w-4 h-4 text-slate-500" />
              )}
              <span>Automatic Background Removal (rembg)</span>
            </label>
          </div>
        </div>
      )}

      {/* Text Prompt Mode */}
      {mode === 'text' && (
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
              <span>HunyuanDiT Prompt Description</span>
            </label>
            <textarea
              rows={3}
              value={textPrompt}
              onChange={(e) => onTextPromptChange(e.target.value)}
              placeholder="e.g. A 3D model of a cute cat wearing astronaut suit, highly detailed, white background..."
              className="w-full bg-slate-950 border border-slate-800 focus:border-cyan-500 rounded-lg p-2.5 text-xs text-slate-200 placeholder-slate-600 outline-none transition-colors"
            />
          </div>

          <div>
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block mb-1.5">
              Suggested Prompts
            </span>
            <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto pr-1">
              {samplePrompts.slice(0, 5).map((p, idx) => (
                <button
                  key={idx}
                  onClick={() => onTextPromptChange(p)}
                  className="text-[11px] text-left bg-slate-800/60 hover:bg-cyan-950/40 hover:text-cyan-300 hover:border-cyan-800 text-slate-300 px-2 py-1 rounded border border-slate-700/60 transition-colors line-clamp-1"
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Multi-View Mode */}
      {mode === 'multiview' && (
        <div className="space-y-3">
          <p className="text-xs text-slate-400 mb-2">
            Upload corresponding views for highest geometric consistency:
          </p>
          <div className="grid grid-cols-2 gap-2">
            {/* Front */}
            <div className="relative border border-slate-700 bg-slate-950 rounded-lg p-2 text-center h-28 flex flex-col items-center justify-center">
              <input
                ref={mvFrontRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => handleFileUpload(e, 'front')}
              />
              {multiView.front ? (
                <>
                  <img src={multiView.front} alt="Front" className="max-h-20 object-contain" />
                  <button
                    onClick={() => onMultiViewChange({ ...multiView, front: null })}
                    className="absolute top-1 right-1 p-1 bg-slate-900 rounded-full text-rose-400 hover:bg-slate-800"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </>
              ) : (
                <div onClick={() => mvFrontRef.current?.click()} className="cursor-pointer">
                  <Upload className="w-5 h-5 mx-auto text-slate-500 mb-1" />
                  <span className="text-[11px] font-medium text-slate-300">Front View *</span>
                </div>
              )}
            </div>

            {/* Back */}
            <div className="relative border border-slate-700 bg-slate-950 rounded-lg p-2 text-center h-28 flex flex-col items-center justify-center">
              <input
                ref={mvBackRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => handleFileUpload(e, 'back')}
              />
              {multiView.back ? (
                <>
                  <img src={multiView.back} alt="Back" className="max-h-20 object-contain" />
                  <button
                    onClick={() => onMultiViewChange({ ...multiView, back: null })}
                    className="absolute top-1 right-1 p-1 bg-slate-900 rounded-full text-rose-400 hover:bg-slate-800"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </>
              ) : (
                <div onClick={() => mvBackRef.current?.click()} className="cursor-pointer">
                  <Upload className="w-5 h-5 mx-auto text-slate-500 mb-1" />
                  <span className="text-[11px] font-medium text-slate-300">Back View</span>
                </div>
              )}
            </div>

            {/* Left */}
            <div className="relative border border-slate-700 bg-slate-950 rounded-lg p-2 text-center h-28 flex flex-col items-center justify-center">
              <input
                ref={mvLeftRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => handleFileUpload(e, 'left')}
              />
              {multiView.left ? (
                <>
                  <img src={multiView.left} alt="Left" className="max-h-20 object-contain" />
                  <button
                    onClick={() => onMultiViewChange({ ...multiView, left: null })}
                    className="absolute top-1 right-1 p-1 bg-slate-900 rounded-full text-rose-400 hover:bg-slate-800"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </>
              ) : (
                <div onClick={() => mvLeftRef.current?.click()} className="cursor-pointer">
                  <Upload className="w-5 h-5 mx-auto text-slate-500 mb-1" />
                  <span className="text-[11px] font-medium text-slate-300">Left View</span>
                </div>
              )}
            </div>

            {/* Right */}
            <div className="relative border border-slate-700 bg-slate-950 rounded-lg p-2 text-center h-28 flex flex-col items-center justify-center">
              <input
                ref={mvRightRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => handleFileUpload(e, 'right')}
              />
              {multiView.right ? (
                <>
                  <img src={multiView.right} alt="Right" className="max-h-20 object-contain" />
                  <button
                    onClick={() => onMultiViewChange({ ...multiView, right: null })}
                    className="absolute top-1 right-1 p-1 bg-slate-900 rounded-full text-rose-400 hover:bg-slate-800"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </>
              ) : (
                <div onClick={() => mvRightRef.current?.click()} className="cursor-pointer">
                  <Upload className="w-5 h-5 mx-auto text-slate-500 mb-1" />
                  <span className="text-[11px] font-medium text-slate-300">Right View</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
