'use client';
import { useState, useRef, useEffect, useCallback } from 'react';
import { PDFDocument, PDFFont, PDFPage, rgb, StandardFonts } from 'pdf-lib';
import styles from '../third/styles.module.scss';

type Annotation = {
  id: string;
  type: 'text' | 'highlight' | 'underline' | 'comment' | 'signature';
  content: string;
  position: { x: number; y: number; width: number; height: number };
  color?: string;
  imageData?: string;
};

type TextOptions = {
    x: number;
    y: number;
    size: number;
    font: PDFFont;
    color: ReturnType<typeof rgb>;
  };
  
  type RectangleOptions = {
    x: number;
    y: number;
    width: number;
    height: number;
    color: ReturnType<typeof rgb>;
    opacity: number;
  };

export default function PDFEditor() {
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [activeTool, setActiveTool] = useState<'text' | 'highlight' | 'underline' | 'comment' | 'signature'>('text');
  const [content, setContent] = useState('');
  const [position, setPosition] = useState({ x: 50, y: 50, width: 100, height: 20 });
  const [color, setColor] = useState('#FFFF00');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState(false);
  const [isDrawing, setIsDrawing] = useState(false);
  const [signatureData, setSignatureData] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const signatureCanvasRef = useRef<HTMLCanvasElement>(null);
  const downloadRef = useRef<HTMLAnchorElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);

  const handlePdfUpload = useCallback(async (file: File) => {
    if (!file) return;
    
    setPdfFile(file);
    setPdfUrl(URL.createObjectURL(file));
    setAnnotations([]);
    setEditingId(null);
    setPreviewMode(false);
    setSignatureData(null);
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handlePdfUpload(file);
  };

  useEffect(() => {
    const dropZone = dropZoneRef.current;
    if (!dropZone) return;

    const preventDefaults = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
    };

    const handleDrop = (e: DragEvent) => {
      preventDefaults(e);
      if (e.dataTransfer?.files.length) {
        const file = e.dataTransfer.files[0];
        if (file.type === 'application/pdf') {
          handlePdfUpload(file);
        }
      }
    };

    dropZone.addEventListener('dragenter', preventDefaults);
    dropZone.addEventListener('dragover', preventDefaults);
    dropZone.addEventListener('drop', handleDrop);

    return () => {
      dropZone.removeEventListener('dragenter', preventDefaults);
      dropZone.removeEventListener('dragover', preventDefaults);
      dropZone.removeEventListener('drop', handleDrop);
    };
  }, [handlePdfUpload]);

  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!signatureCanvasRef.current) return;
    const canvas = signatureCanvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    setIsDrawing(true);
    ctx.beginPath();
    ctx.moveTo(
      e.clientX - rect.left,
      e.clientY - rect.top
    );
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing || !signatureCanvasRef.current) return;
    const canvas = signatureCanvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.lineTo(
      e.clientX - rect.left,
      e.clientY - rect.top
    );
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
  };

  const endDrawing = () => {
    setIsDrawing(false);
    if (signatureCanvasRef.current) {
      setSignatureData(signatureCanvasRef.current.toDataURL());
    }
  };

  const clearSignature = () => {
    if (signatureCanvasRef.current) {
      const ctx = signatureCanvasRef.current.getContext('2d');
      if (ctx) {
        ctx.clearRect(
          0, 
          0, 
          signatureCanvasRef.current.width, 
          signatureCanvasRef.current.height
        );
        setSignatureData(null);
      }
    }
  };

  const startDragging = (e: React.MouseEvent, id: string) => {
    const annotation = annotations.find(ann => ann.id === id);
    if (!annotation) return;

    setDraggingId(id);
    setDragOffset({
      x: e.clientX - annotation.position.x,
      y: e.clientY - annotation.position.y
    });
  };

  const handleDrag = (e: React.MouseEvent) => {
    if (!draggingId) return;

    setAnnotations(prevAnnotations => 
      prevAnnotations.map(ann => 
        ann.id === draggingId 
          ? { 
              ...ann, 
              position: { 
                ...ann.position, 
                x: e.clientX - dragOffset.x,
                y: e.clientY - dragOffset.y
              } 
            } 
          : ann
      )
    );
  };

  const endDragging = () => {
    setDraggingId(null);
    updatePdfPreview();
  };

  const startEditing = (id: string) => {
    const annotation = annotations.find(ann => ann.id === id);
    if (!annotation) return;
    
    setEditingId(id);
    setActiveTool(annotation.type);
    setContent(annotation.content);
    setPosition(annotation.position);
    if (annotation.color) setColor(annotation.color);
    if (annotation.imageData) setSignatureData(annotation.imageData);
    setPreviewMode(true);
  };

  const deleteAnnotation = (id: string) => {
    setAnnotations(prevAnnotations => prevAnnotations.filter(ann => ann.id !== id));
    if (editingId === id) {
      cancelEditing();
    }
    updatePdfPreview();
  };

  const cancelEditing = () => {
    setEditingId(null);
    setContent('');
    setSignatureData(null);
    setPreviewMode(false);
    updatePdfPreview();
  };

  const saveAnnotation = async () => {
    if ((!content && activeTool !== 'signature') || !pdfFile) return;

    const newAnnotation: Annotation = {
      id: editingId || Date.now().toString(),
      type: activeTool,
      content: activeTool === 'signature' ? 'Signature' : content,
      position,
      color: ['highlight', 'underline'].includes(activeTool) ? color : undefined,
      imageData: activeTool === 'signature' ? signatureData || undefined : undefined
    };

    setAnnotations(prevAnnotations => 
      editingId 
        ? prevAnnotations.map(ann => ann.id === editingId ? newAnnotation : ann)
        : [...prevAnnotations, newAnnotation]
    );

    cancelEditing();
  };

  const applyAnnotationToPage = useCallback(async (

    annotation: Annotation,
    page: PDFPage,
    font: PDFFont,
    isPreview = false
  ) => {
    switch (annotation.type) {
      case 'text':
        const textOptions: TextOptions = {
          x: annotation.position.x,
          y: annotation.position.y,
          size: 12,
          font,
          color: isPreview ? rgb(0, 0, 0.5) : rgb(0, 0, 0)
        };
        page.drawText(annotation.content, textOptions);
        break;
        
      case 'highlight':
        if (annotation.color) {
          const rgbColor = hexToRgb(annotation.color);
          const rectOptions: RectangleOptions = {
            x: annotation.position.x,
            y: annotation.position.y,
            width: annotation.position.width,
            height: annotation.position.height,
            color: rgb(rgbColor.r / 255, rgbColor.g / 255, rgbColor.b / 255),
            opacity: isPreview ? 0.3 : 0.5
          };
          page.drawRectangle(rectOptions);
        }
        break;
        
      case 'underline':
        if (annotation.color) {
          const rgbColor = hexToRgb(annotation.color);
          page.drawLine({
            start: { x: annotation.position.x, y: annotation.position.y },
            end: { x: annotation.position.x + annotation.position.width, y: annotation.position.y },
            thickness: 2,
            color: rgb(rgbColor.r / 255, rgbColor.g / 255, rgbColor.b / 255),
            opacity: isPreview ? 0.7 : 1,
          });
        }
        break;
        
      case 'comment':
        page.drawText(annotation.content, {
          x: annotation.position.x,
          y: annotation.position.y,
          size: 10,
          font,
          color: isPreview ? rgb(0, 0, 0.5) : rgb(0, 0, 0),
        });
        break;
        
      case 'signature':
        if (annotation.imageData) {
          try {
            const imageBytes = Uint8Array.from(
              atob(annotation.imageData.split(',')[1]), 
              c => c.charCodeAt(0)
            );
            const pdfDoc = page.doc;
            const image = await pdfDoc.embedPng(imageBytes);
            page.drawImage(image, {
              x: annotation.position.x,
              y: annotation.position.y,
              width: 150,
              height: 60,
              opacity: isPreview ? 0.7 : 1,
            });
          } catch (error) {
            console.error('Error embedding signature:', error);
          }
        }
        break;
    }
}, []);

const updatePdfPreview = useCallback(async () => {
    if (!pdfFile) return;
    
    try {
      const existingPdfBytes = await pdfFile.arrayBuffer();
      const pdfDoc = await PDFDocument.load(existingPdfBytes);
      const page = pdfDoc.getPages()[0];
      const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);

      // Apply saved annotations
      for (const ann of annotations) {
        await applyAnnotationToPage(ann, page, helveticaFont);
      }

      // If in preview mode, add the current annotation
      if (previewMode && (content || activeTool === 'signature')) {
        const previewAnnotation: Annotation = {
          id: 'preview',
          type: activeTool,
          content,
          position,
          color,
          imageData: signatureData || undefined
        };
        await applyAnnotationToPage(previewAnnotation, page, helveticaFont, true);
      }

      const modifiedPdf = await pdfDoc.save();
      setPdfUrl(URL.createObjectURL(new Blob([modifiedPdf], { type: 'application/pdf' })));
      
    } catch (error) {
      console.error('Error updating PDF preview:', error);
    }
  }, [pdfFile, annotations, previewMode, content, activeTool, position, color, signatureData, applyAnnotationToPage]);
  

  const downloadPdf = async () => {
    if (!pdfFile || !downloadRef.current) return;
    
    const existingPdfBytes = await pdfFile.arrayBuffer();
    const pdfDoc = await PDFDocument.load(existingPdfBytes);
    const page = pdfDoc.getPages()[0];
    const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);

    for (const ann of annotations) {
      await applyAnnotationToPage(ann, page, helveticaFont);
    }

    const modifiedPdf = await pdfDoc.save();
    const url = URL.createObjectURL(new Blob([modifiedPdf], { type: 'application/pdf' }));
    downloadRef.current.href = url;
    downloadRef.current.download = 'annotated-document.pdf';
    downloadRef.current.click();
    URL.revokeObjectURL(url);
  };

  const hexToRgb = (hex: string) => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16)
    } : { r: 0, g: 0, b: 0 };
  };

  useEffect(() => {
    updatePdfPreview();
  }, [annotations, updatePdfPreview]);


  

  return (
    <div 
      className={styles.container}
      onMouseMove={draggingId ? handleDrag : undefined}
      onMouseUp={draggingId ? endDragging : undefined}
      onMouseLeave={draggingId ? endDragging : undefined}
    >
      <div className={styles.header}>
        <h1>PDF Annotation Editor</h1>
        <p>Add, preview, edit and save annotations</p>
      </div>
      
      <div 
        ref={dropZoneRef}
        className={styles.uploadSection}
      >
        <label className={styles.uploadLabel}>Upload PDF (drag & drop or click to browse):</label>
        <input 
        style={{ fontSize: "16px"}}
          type="file" 
          accept="application/pdf"
          onChange={handleFileChange}
          className={styles.uploadInput}
        />
      </div>
      
      {pdfUrl && (
        <div className={styles.editorContainer}>
          <div className={styles.toolbar}>
            {(['text', 'highlight', 'underline', 'comment', 'signature'] as const).map((tool) => (
              <button
                key={tool}
                className={`${styles.toolButton} ${activeTool === tool ? styles.active : ''}`}
                onClick={() => {
                  setActiveTool(tool);
                  setPreviewMode(false);
                  setEditingId(null);
                }}
              >
                {tool.charAt(0).toUpperCase() + tool.slice(1)}
              </button>
            ))}
          </div>
          
          <div className={styles.editorPanel}>
            <div className={styles.controls}>
              {activeTool !== 'signature' && (
                <div className={styles.controlGroup}>
                  <label>
                    {activeTool === 'text' && 'Text Content'}
                    {activeTool === 'highlight' && 'Highlight Area'}
                    {activeTool === 'underline' && 'Text to Underline'}
                    {activeTool === 'comment' && 'Comment Text'}
                  </label>
                  <input
                  style={{ fontSize: "16px"}}
                    type="text"
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    placeholder={
                      activeTool === 'text' ? 'Enter text' :
                      activeTool === 'comment' ? 'Enter comment' :
                      'Describe area'
                    }
                  />
                </div>
              )}
              
              {(activeTool === 'highlight' || activeTool === 'underline') && (
                <div className={styles.controlGroup}>
                  <label>Color:</label>
                  <input
                  style={{ fontSize: "16px"}}
                    type="color"
                    value={color}
                    onChange={(e) => setColor(e.target.value)}
                    className={styles.colorPicker}
                  />
                </div>
              )}
              
              {activeTool === 'signature' && (
                <div className={styles.controlGroup}>
                  <label>Draw Signature:</label>
                  <canvas
                    ref={signatureCanvasRef}
                    width={300}
                    height={150}
                    className={styles.signatureCanvas}
                    onMouseDown={startDrawing}
                    onMouseMove={draw}
                    onMouseUp={endDrawing}
                    onMouseLeave={endDrawing}
                  />
                  <div className={styles.signatureActions}>
                    <button
                      onClick={clearSignature}
                      className={styles.secondaryButton}
                    >
                      Clear
                    </button>
                  </div>
                </div>
              )}
              
              <div className={styles.controlGroup}>
                <label>Position:</label>
                <div className={styles.positionInputs}>
                  <input
                  style={{ fontSize: "16px"}}
                    type="number"
                    value={position.x}
                    onChange={(e) => {
                      setPosition(prev => ({...prev, x: parseInt(e.target.value) || 0}));
                      if (content || activeTool === 'signature') setPreviewMode(true);
                    }}
                    placeholder="X"
                  />
                  <input
                  style={{ fontSize: "16px"}}
                    type="number"
                    value={position.y}
                    onChange={(e) => {
                      setPosition(prev => ({...prev, y: parseInt(e.target.value) || 0}));
                      if (content || activeTool === 'signature') setPreviewMode(true);
                    }}
                    placeholder="Y"
                  />
                  {(activeTool === 'highlight' || activeTool === 'underline') && (
                    <>
                      <input
                      style={{ fontSize: "16px"}}
                        type="number"
                        value={position.width}
                        onChange={(e) => {
                          setPosition(prev => ({...prev, width: parseInt(e.target.value) || 0}));
                          if (content) setPreviewMode(true);
                        }}
                        placeholder="Width"
                      />
                      <input
                      style={{ fontSize: "16px"}}
                        type="number"
                        value={position.height}
                        onChange={(e) => {
                          setPosition(prev => ({...prev, height: parseInt(e.target.value) || 0}));
                          if (content) setPreviewMode(true);
                        }}
                        placeholder="Height"
                      />
                    </>
                  )}
                </div>
              </div>
              
              <div className={styles.buttonGroup}>
                {previewMode && (
                  <>
                    <button
                      onClick={saveAnnotation}
                      className={styles.saveButton}
                      disabled={activeTool === 'signature' && !signatureData}
                    >
                      {editingId ? 'Update' : 'Save'}
                    </button>
                    <button
                      onClick={cancelEditing}
                      className={styles.cancelButton}
                    >
                      Cancel
                    </button>
                  </>
                )}
                
                {!previewMode && (content || activeTool === 'signature') && (
                  <button
                    onClick={() => setPreviewMode(true)}
                    className={styles.previewButton}
                    disabled={activeTool === 'signature' && !signatureData}
                  >
                    Preview
                  </button>
                )}
              </div>
              
              {annotations.length > 0 && (
                <div className={styles.annotationsList}>
                  <h4>Saved Annotations ({annotations.length}):</h4>
                  <ul>
                    {annotations.map((ann) => (
                      <li 
                        key={ann.id} 
                        className={styles.annotationItem}
                        onMouseDown={(e) => startDragging(e, ann.id)}
                        style={{ cursor: 'move' }}
                      >
                        <div className={styles.annotationContent}>
                          <strong>{ann.type}:</strong> {ann.content} 
                          (X: {ann.position.x}, Y: {ann.position.y})
                        </div>
                        <div className={styles.annotationActions}>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              startEditing(ann.id);
                            }}
                            className={styles.editButton}
                          >
                            Edit
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteAnnotation(ann.id);
                            }}
                            className={styles.deleteButton}
                          >
                            Delete
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            
            <div className={styles.previewArea}>
              <iframe
                src={pdfUrl}
                className={styles.pdfFrame}
                title="PDF Preview"
              />
              {previewMode && (
                <div className={styles.previewOverlay}>
                  Preview mode - Adjust position and click Save
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      
      {annotations.length > 0 && (
        <div className={styles.downloadSection}>
          <button
            onClick={downloadPdf}
            className={styles.downloadButton}
          >
            Download Annotated PDF
          </button>
          <a ref={downloadRef} className={styles.hidden} />
        </div>
      )}
    </div>
  );
}