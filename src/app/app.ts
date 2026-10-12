import { ChangeDetectionStrategy, Component } from '@angular/core';

import { MapComponent } from './components/map/map';
import { SidebarComponent } from './components/sidebar/sidebar';

@Component({
  selector: 'app-root',
  imports: [MapComponent, SidebarComponent],
  templateUrl: './app.html',
  styleUrl: './app.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {}
