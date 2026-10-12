import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';

import { BuildingService } from '../../services/building.service';
import { CameraService } from '../../services/camera.service';
import { SettingsService } from '../../services/settings.service';
import { CameraEditorComponent } from '../camera-editor/camera-editor';

import type { MapComponent } from '../map/map';

const ISO_DATE_LENGTH = 10; // YYYY-MM-DD

@Component({
  selector: 'app-sidebar',
  imports: [CameraEditorComponent],
  templateUrl: './sidebar.html',
  styleUrl: './sidebar.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SidebarComponent {
  protected cameraService = inject(CameraService);
  protected buildingService = inject(BuildingService);
  protected settingsService = inject(SettingsService);
  protected readonly collapsed = signal(false);
  protected readonly settingsOpen = signal(false);

  readonly mapRef = input.required<MapComponent>();

  protected toggleCollapse(): void {
    this.collapsed.update((v) => !v);
  }

  protected addCamera(): void {
    const center = this.mapRef().getCenter();
    this.cameraService.addCamera(center.lat, center.lng);
  }

  protected selectCamera(id: string): void {
    this.cameraService.selectCamera(id);
  }

  protected onCameraKeydown(id: string, event: KeyboardEvent): void {
    // Ignore key events bubbling up from the nested Delete button
    if (event.target !== event.currentTarget) {
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.selectCamera(id);
    }
  }

  protected deleteCamera(id: string, event: Event): void {
    event.stopPropagation();
    this.cameraService.deleteCamera(id);
  }

  protected exportCameras(): void {
    const json = this.cameraService.exportToJson();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cameras-${new Date().toISOString().slice(0, ISO_DATE_LENGTH)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  protected toggleBuildings(): void {
    this.buildingService.setEnabled(!this.buildingService.enabled());
  }

  protected updateSearchRadius(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    if (value > 0) {
      this.buildingService.setSearchRadius(value);
    }
  }

  protected updateOffsetX(event: Event): void {
    this.buildingService.setOffsetX(Number((event.target as HTMLInputElement).value));
  }

  protected updateOffsetY(event: Event): void {
    this.buildingService.setOffsetY(Number((event.target as HTMLInputElement).value));
  }

  protected toggleSettings(): void {
    this.settingsOpen.update((v) => !v);
  }

  protected updateApiKey(provider: 'google' | 'mapbox' | 'bing', event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    switch (provider) {
      case 'google':
        this.settingsService.setGoogleApiKey(value);
        break;
      case 'mapbox':
        this.settingsService.setMapboxToken(value);
        break;
      case 'bing':
        this.settingsService.setBingApiKey(value);
        break;
      default:
        break;
    }
  }

  protected importCameras(event: Event): void {
    const fileInput = event.target as HTMLInputElement;
    const file = fileInput.files?.[0];
    if (!file) {
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = this.cameraService.importFromJson(reader.result as string);
      if (!result.success) {
        // eslint-disable-next-line no-alert -- simple blocking error prompt; the app has no in-app notification UI
        alert(`Import failed: ${result.error ?? 'unknown error'}`);
      }
    };
    reader.readAsText(file);
    fileInput.value = '';
  }
}
