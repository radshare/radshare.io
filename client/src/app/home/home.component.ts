import {AfterViewInit, Component, OnInit, ViewChild} from '@angular/core';
import {RelicService} from '../relic.service';
import {MatPaginator} from '@angular/material/paginator';
import {MatSort} from '@angular/material/sort';
import {MatDialog, MatDialogConfig} from '@angular/material/dialog';
import {RadDialogComponent} from './raddialog/rad-dialog.component';
import {catchError, map, startWith, switchMap} from 'rxjs/operators';
import {merge, Observable, of} from 'rxjs';

export interface RadRoom {
  expirationDate?: number;
  relic: string;
  quality: string;
  platform: string;
  tenno: string;
  code?: string;
}

@Component({
  selector: 'app-home',
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.css']
})
export class HomeComponent implements AfterViewInit, OnInit{
  displayedColumns: string[] = ['relic', 'quality', 'platform', 'tenno', 'deadline'];
  private isLoadingResults: boolean;

  @ViewChild(MatPaginator) paginator: MatPaginator;
  @ViewChild(MatSort) sort: MatSort;
  private resultsLength = 0;
  data: RadRoom[] | RadRoom;

  constructor(private relics: RelicService, private newRadDiaglog: MatDialog) {
  }

  ngOnInit(): void {
    /**
    this.dataSource = new MatTableDataSource([
      {relic: 'MESO G1', quality: 'Radiant', platform: 'PC', tenno: '1', deadline: '???'},
      {relic: 'NEO N1', quality: 'Radiant', platform: 'PC', tenno: '3', deadline: '???'},
      {relic: 'NEO N2', quality: 'Intact', platform: 'Switch', tenno: '4', deadline: '???'}
    ]);
     **/
  }

  ngAfterViewInit(){
    this.sort.sortChange.subscribe(() => this.paginator.pageIndex = 0);
    merge(this.sort.sortChange, this.paginator.page)
      .pipe(
        startWith({}),
        switchMap(() => {
          this.isLoadingResults = true;
          return this.loadRadshares();
        }),
        map(data => {
          // Flip flag to show that loading has finished.
          this.isLoadingResults = false;
          this.resultsLength = data.total_count;
          // Turn the expiration date from milliseconds to a displayable format
          data.data.forEach( (room) => {
            var totalMins = Math.round((room.expirationDate - Date.now()) / 1000 / 60);
            var mins = totalMins % 60;
            var hrs = Math.floor(totalMins / 60);
            room.expirationDate = hrs + ':' + mins.toString().padStart(2, '0');
          });
          return data.data;
        }),
        catchError(() => {
          this.isLoadingResults = false;
          return of([]);
        })
      ).subscribe(data => this.data = data);

    /**
    this.data.paginator = this.paginator;
    this.data.sort = this.sort;
     **/
  }

  openNewRadDialog() {
    const dialogConfig = new MatDialogConfig();

    dialogConfig.autoFocus = true;
    this.newRadDiaglog.open(RadDialogComponent, dialogConfig);
  }

  loadRadshares(): Observable<any> {
    return this.relics.getRadshares();
  }

}
