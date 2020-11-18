import {AfterViewInit, Component, OnInit, ViewChild} from '@angular/core';
import {RelicService} from '../relic.service';
import {Router} from '@angular/router';
import {MatPaginator} from '@angular/material/paginator';
import {MatSort} from '@angular/material/sort';
import {MatTableDataSource} from '@angular/material/table';

@Component({
  selector: 'app-home',
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.css']
})
export class HomeComponent implements AfterViewInit {
  displayedColumns: string[] = ['relic', 'quality', 'platform', 'tenno', 'deadline'];
  data: MatTableDataSource<RadRoom>;
  resultsLength = 0;

  @ViewChild(MatPaginator) paginator: MatPaginator;
  @ViewChild(MatSort) sort: MatSort;

  constructor(private relics: RelicService, private router: Router) {
    this.data = new MatTableDataSource([
      {relic: 'MESO G1', quality: 'Radiant', platform: 'PC', tenno: '2/4', deadline: '???'},
      {relic: 'NEO N1', quality: 'Radiant', platform: 'PC', tenno: '1/4', deadline: '???'},
      {relic: 'NEO N2', quality: 'Intact', platform: 'Switch', tenno: '2/4', deadline: '???'}
      ])
  }

  ngAfterViewInit(){
    this.data.paginator = this.paginator;
    this.data.sort = this.sort;
  }

  loadRadshares(){
    this.relics.getRadshares().subscribe(

    );
  }

}

export interface RadRoom {
  relic: string;
  quality: string;
  platform: string;
  tenno: string;
  deadline: string;
}
